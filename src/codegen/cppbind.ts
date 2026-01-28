/*

cppbind - C++ to Zig binding generator for Bun

This tool automatically generates Zig bindings for C++ functions marked with [[ZIG_EXPORT(...)]] attributes.
It runs automatically when C++ files change during the build process.

To run manually:
    bun src/codegen/cppbind src build/debug/codegen

## USAGE

### Basic Export Tags

1. **nothrow** - Function that never throws exceptions:
   ```cpp
   extern "C" [[ZIG_EXPORT(nothrow)]] void hello_world() {
       printf("hello world\n");
   }
   ```
   Zig usage: `bun.cpp.hello_world();`

2. **zero_is_throw** - Function returns JSValue, where .zero indicates an exception:
   ```cpp
   extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSValue create_object(JSGlobalObject* globalThis) {
       auto scope = DECLARE_THROW_SCOPE();
       // ...
       RETURN_IF_EXCEPTION(scope, {});
       return result;
   }
   ```
   Zig usage: `try bun.cpp.create_object(globalThis);`

3. **check_slow** - Function that may throw, performs runtime exception checking:
   ```cpp
   extern "C" [[ZIG_EXPORT(check_slow)]] void process_data(JSGlobalObject* globalThis) {
       auto scope = DECLARE_THROW_SCOPE();
       // ...
       RETURN_IF_EXCEPTION(scope, );
   }
   ```
   Zig usage: `try bun.cpp.process_data(globalThis);`

### Parameters

- **[[ZIG_NONNULL]]** - Mark pointer parameters as non-nullable:
  ```cpp
  [[ZIG_EXPORT(nothrow)]] void process([[ZIG_NONNULL]] JSGlobalObject* globalThis,
                                        [[ZIG_NONNULL]] JSValue* values,
                                        size_t count) { ... }
  ```
  Generates: `pub extern fn process(globalThis: *jsc.JSGlobalObject, values: [*]const jsc.JSValue) void;`

*/

const start = Date.now();
let isInstalled = false;
try {
  const grammarfile = await Bun.file("node_modules/@lezer/cpp/src/cpp.grammar").text();
  isInstalled = true;
} catch (e) {}
if (!isInstalled) {
  if (process.argv.includes("--already-installed")) {
    console.error("Lezer C++ grammar is not installed. Please run `bun install` to install it.");
    process.exit(1);
  }
  const r = Bun.spawnSync([process.argv[0], "install", "--frozen-lockfile"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.exitCode !== 0) {
    console.error(r.stdout.toString());
    console.error(r.stderr.toString());
    process.exit(r.exitCode ?? 1);
  }

  const r2 = Bun.spawnSync([...process.argv, "--already-installed"], { stdio: ["inherit", "inherit", "inherit"] });
  process.exit(r2.exitCode ?? 1);
}

type SyntaxNode = import("@lezer/common").SyntaxNode;
const { parser: cppParser } = await import("@lezer/cpp");
const { mkdir } = await import("fs/promises");
const { join, relative } = await import("path");
const { bannedTypes, sharedTypes, typeDeclarations } = await import("./shared-types");

type Point = {
  line: number;
  column: number;
};
type Srcloc = {
  file: string;
  start: Point;
  end: Point;
};
type CppFn = {
  name: string;
  returnType: CppType;
  parameters: CppParameter[];
  position: Srcloc;
  tag: ExportTag;
};
type CppParameter = {
  type: CppType;
  name: string;
};
type CppType =
  | {
      type: "pointer";
      child: CppType;
      position: Srcloc;
      isConst: boolean;
      isMany: boolean;
      isNonNull: boolean;
    }
  | {
      type: "named";
      name: string;
      position: Srcloc;
    }
  | {
      type: "fn";
      parameters: CppParameter[];
      returnType: CppType;
      position: Srcloc;
    };

type PositionedError = {
  position: Srcloc;
  message: string;
  notes: { position: Srcloc; message: string }[];
};
const errors: PositionedError[] = [];
function appendError(position: Srcloc, message: string): PositionedError {
  const error: PositionedError = { position, message, notes: [] };
  errors.push(error);
  return error;
}
function appendErrorFromCatch(error: unknown, position: Srcloc): PositionedError {
  if (error instanceof PositionedErrorClass) {
    errors.push(error);
    return error;
  }
  if (error instanceof Error) {
    return appendError(position, error.message);
  }
  return appendError(position, "unknown error: " + JSON.stringify(error));
}
function throwError(position: Srcloc, message: string): never {
  throw new PositionedErrorClass(position, message);
}
class PositionedErrorClass extends Error {
  notes: { position: Srcloc; message: string }[] = [];
  constructor(
    public position: Srcloc,
    message: string,
  ) {
    super(message);
  }
}

// Lezer works with offsets, but our errors need line/column. This utility handles the conversion.
class LineInfo {
  private lineStarts: number[];
  constructor(private source: string) {
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  get(offset: number): Point {
    // A binary search would be faster, but this is fine for files of this size.
    let line = 1;
    let lineStart = 0;
    for (let i = this.lineStarts.length - 1; i >= 0; i--) {
      if (this.lineStarts[i] <= offset) {
        line = i + 1;
        lineStart = this.lineStarts[i];
        break;
      }
    }
    const column = offset - lineStart + 1;
    return { line, column };
  }
}

// A context object to pass around file-specific parsing information.
type ParseContext = {
  file: string;
  sourceCode: string;
  lineInfo: LineInfo;
};

function nodePosition(node: SyntaxNode, ctx: ParseContext): Srcloc {
  return {
    file: ctx.file,
    start: ctx.lineInfo.get(node.from),
    end: ctx.lineInfo.get(node.to),
  };
}
const text = (node: SyntaxNode, ctx: ParseContext) => ctx.sourceCode.slice(node.from, node.to);

function assertNever(value: never): never {
  throw new Error("assertNever");
}

export function prettyPrintLezerNode(node: SyntaxNode, sourceCode: string): string {
  const lines: string[] = [];
  const printRecursive = (currentNode: SyntaxNode, prefix: string, isLast: boolean) => {
    // Determine the connector shape
    const connector = isLast ? "└─ " : "├─ ";
    const linePrefix = prefix + connector;

    // Get the node's text, escape newlines, and truncate for readability
    const nodeText = sourceCode.slice(currentNode.from, currentNode.to);
    let truncatedText = nodeText.replace(/\n/g, "\\n");
    if (truncatedText.length > 50) {
      truncatedText = truncatedText.slice(0, 50) + "...";
    }

    // Format and add the current node's line
    lines.push(`${linePrefix}${currentNode.name} [${currentNode.from}..${currentNode.to}] "${truncatedText}"`);
    if (currentNode.name === "CompoundStatement") {
      lines.push(prefix + "    └─ ...");
      return;
    }

    // Prepare the prefix for the children
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    // Recurse for children
    const children: SyntaxNode[] = [];
    const cursor = currentNode.cursor();
    if (cursor.firstChild()) {
      do {
        children.push(cursor.node);
      } while (cursor.nextSibling());
    }

    children.forEach((child, index) => {
      printRecursive(child, childPrefix, index === children.length - 1);
    });
  };

  // Start the process for the root node without any prefix/connector
  const rootText = sourceCode.slice(node.from, node.to).replace(/\n/g, "\\n").slice(0, 50);
  lines.push(`${node.name} [${node.from}..${node.to}] "${rootText}${rootText.length === 50 ? "..." : ""}"`);

  const children: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      children.push(cursor.node);
    } while (cursor.nextSibling());
  }

  children.forEach((child, index) => {
    printRecursive(child, "", index === children.length - 1);
  });

  return lines.join("\n");
}

function getChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    children.push(child);
    child = child.nextSibling;
  }
  return children;
}

const allowedLezerTypes = new Set(["PrimitiveType", "ScopedTypeIdentifier", "TypeIdentifier", "SizedTypeSpecifier"]);
function processRootmostType(ctx: ParseContext, node: SyntaxNode): CppType {
  const children = getChildren(node);
  for (const child of children) {
    if (allowedLezerTypes.has(child.type.name)) {
      return { type: "named", name: text(child, ctx), position: nodePosition(child, ctx) };
    }
  }
  throwError(nodePosition(node, ctx), "no valid type found:\n" + prettyPrintLezerNode(node, ctx.sourceCode));
}

function processDeclarator(
  ctx: ParseContext,
  node: SyntaxNode, // Initially a FunctionDefinition/ParameterDeclaration, then recursively a Declarator variant
  rootmostType?: CppType,
): { type: CppType; final: SyntaxNode } {
  // Initial entry point with a definition/declaration, find the top-level declarator
  if (node.name === "FunctionDefinition" || node.name === "ParameterDeclaration") {
    rootmostType ??= processRootmostType(ctx, node);
  } else {
    if (!rootmostType)
      throwError(
        nodePosition(node, ctx),
        "no rootmost type provided to declarator:\n" + prettyPrintLezerNode(node, ctx.sourceCode),
      );
  }

  const children = getChildren(node);
  const declarators = children.filter(child => child.name.endsWith("Declarator") || child.name === "Identifier");
  if (declarators.length !== 1) {
    throwError(
      nodePosition(node, ctx),
      "no or multiple declarators found:\n" + prettyPrintLezerNode(node, ctx.sourceCode),
    );
  }
  const declarator = declarators[0]!;

  // Recursively peel off pointers
  if (declarator?.name === "PointerDeclarator") {
    if (!rootmostType) throwError(nodePosition(declarator, ctx), "no rootmost type provided to PointerDeclarator");
    const isConst = !!declarator.parent?.getChild("const") || rootmostType.type === "fn";
    const parentAttributes = declarator.parent?.getChildren("Attribute") ?? [];
    const isNonNull = parentAttributes.some(attr => text(attr.getChild("AttributeName")!, ctx) === "ZIG_NONNULL");

    return processDeclarator(ctx, declarator, {
      type: "pointer",
      child: rootmostType,
      position: nodePosition(declarator, ctx),
      isConst,
      isNonNull,
      isMany: false,
    });
  } else if (declarator?.name === "ReferenceDeclarator") {
    throwError(nodePosition(declarator, ctx), "references are not allowed");
  } else if (declarator?.name === "FunctionDeclarator" && !declarator.getChild("Identifier")) {
    const lhs = declarator.getChild("ParenthesizedDeclarator");
    const rhs = declarator.getChild("ParameterList");
    if (!lhs || !rhs) {
      throwError(
        nodePosition(declarator, ctx),
        "FunctionDeclarator has neither Identifier nor ParenthesizedDeclarator:\n" +
          prettyPrintLezerNode(declarator, ctx.sourceCode),
      );
    }
    const fnType: CppType = {
      type: "fn",
      parameters: [],
      returnType: rootmostType,
      position: nodePosition(declarator, ctx),
    };
    for (const arg of rhs.getChildren("ParameterDeclaration")) {
      const paramDeclarator = processDeclarator(ctx, arg);
      fnType.parameters.push({ type: paramDeclarator.type, name: text(paramDeclarator.final, ctx) });
    }
    return processDeclarator(ctx, lhs, fnType);
  }

  return { type: rootmostType, final: declarator };
}

function processFunction(ctx: ParseContext, node: SyntaxNode, tag: ExportTag): CppFn {
  // `node` is a FunctionDefinition
  const declarator = processDeclarator(ctx, node);
  const final = declarator.final;

  if (final.name !== "FunctionDeclarator") {
    throwError(nodePosition(final, ctx), "not a function_declarator: " + final.name);
  }
  const nameNode = final.getChild("Identifier");
  if (!nameNode) throwError(nodePosition(final, ctx), "no name found:\n" + prettyPrintLezerNode(final, ctx.sourceCode));

  const parameterList = final.getChild("ParameterList");
  if (!parameterList) throwError(nodePosition(final, ctx), "no parameter list found");

  const parameters: CppParameter[] = [];
  for (const parameter of parameterList.getChildren("ParameterDeclaration")) {
    const paramDeclarator = processDeclarator(ctx, parameter);
    const name = paramDeclarator.final;

    if (name.name !== "Identifier") {
      throwError(nodePosition(name, ctx), "parameter name is not an identifier: " + name.name);
    }

    parameters.push({ type: paramDeclarator.type, name: text(name, ctx) });
  }

  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    const next = parameters[i + 1];
    if (param.type.type === "pointer" && next?.type.type === "named" && next.type.name === "size_t") {
      param.type.isMany = true;
      i++;
    }
  }

  return {
    returnType: declarator.type,
    name: text(nameNode, ctx),
    parameters,
    position: nodePosition(nameNode, ctx),
    tag,
  };
}

type ExportTag = "check_slow" | "zero_is_throw" | "false_is_throw" | "null_is_throw" | "nothrow";

const sharedTypesText = await Bun.file("src/codegen/shared-types.ts").text();
const sharedTypesLines = sharedTypesText.split("\n");
let sharedTypesLine = 0;
let sharedTypesColumn = 0;
let sharedTypesColumnEnd = 0;
for (const line of sharedTypesLines) {
  sharedTypesLine++;
  if (line.includes("export const sharedTypes")) {
    sharedTypesColumn = line.indexOf("sharedTypes") + 1;
    sharedTypesColumnEnd = sharedTypesColumn + "sharedTypes".length;
    break;
  }
}

const errorsForTypes: Map<string, PositionedError> = new Map();
function generateZigType(type: CppType, parent: CppType | null) {
  if (type.type === "pointer") {
    const optionalChar = type.isNonNull ? "" : "?";
    const ptrChar = type.isMany ? "[*]" : "*";
    const constChar = type.isConst ? "const " : "";
    return `${optionalChar}${ptrChar}${constChar}${generateZigType(type.child, type)}`;
  }
  if (type.type === "fn") {
    return `fn(${type.parameters.map(p => formatZigName(p.name) + ": " + generateZigType(p.type, null)).join(", ")}) callconv(.c) ${generateZigType(type.returnType, null)}`;
  }
  if (type.type === "named" && type.name === "void") {
    if (parent?.type === "pointer") return "anyopaque";
    if (!parent) return "void";
    throwError(type.position, "void must have a pointer parent or no parent");
  }
  if (type.type === "named") {
    const bannedType = bannedTypes[type.name];
    if (bannedType) {
      appendError(type.position, bannedType);
      return "anyopaque";
    }
    const sharedType = sharedTypes[type.name];
    if (sharedType) return sharedType;
    const error = errorsForTypes.has(type.name)
      ? errorsForTypes.get(type.name)!
      : appendError(
          {
            file: "src/codegen/shared-types.ts",
            start: { line: sharedTypesLine, column: sharedTypesColumn },
            end: { line: sharedTypesLine, column: sharedTypesColumnEnd },
          },
          "sharedTypes is missing type: " + JSON.stringify(type.name),
        );
    errorsForTypes.set(type.name, error);
    error.notes.push({ position: type.position, message: "used in exported function here" });
    return "anyopaque";
  }
  assertNever(type);
}
function formatZigName(name: string): string {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) return name;
  return "@" + JSON.stringify(name);
}
function generateZigParameterList(parameters: CppParameter[], globalThisArg?: CppParameter): string {
  return parameters
    .map(p => {
      if (p === globalThisArg) {
        return `${formatZigName(p.name)}: *jsc.JSGlobalObject`;
      } else {
        return `${formatZigName(p.name)}: ${generateZigType(p.type, null)}`;
      }
    })
    .join(", ");
}
function generateZigSourceComment(cfg: Cfg, resultSourceLinks: string[], fn: CppFn): string {
  const fileName = relative(cfg.dstDir, fn.position.file);
  resultSourceLinks.push(`${fn.name}:${fileName}:${fn.position.start.line}:${fn.position.start.column}`);
  return `/// Source: ${fn.name}`;
}

function closest(node: SyntaxNode | null, type: string): SyntaxNode | null {
  while (node) {
    if (node.name === type) return node;
    node = node.parent;
  }
  return null;
}

type CppParser = typeof cppParser;

async function processFile(parser: CppParser, file: string, allFunctions: CppFn[]) {
  const sourceCode = await Bun.file(file).text();
  if (!sourceCode.includes("[[ZIG_EXPORT(")) return;

  const sourceCodeLines = sourceCode.split("\n");
  const manualFindLines = new Set<number>();
  for (let i = 0; i < sourceCodeLines.length; i++) {
    if (sourceCodeLines[i].includes("[[ZIG_EXPORT(")) {
      manualFindLines.add(i + 1);
    }
  }

  const tree = parser.parse(sourceCode);
  const lineInfo = new LineInfo(sourceCode);
  const ctx: ParseContext = { file, sourceCode, lineInfo };

  if (!tree) {
    appendError({ file, start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, "no tree found");
    for (const lineNumber of manualFindLines) {
      const lineContent = sourceCodeLines[lineNumber - 1];
      const column = lineContent.indexOf("[[ZIG_EXPORT(") + 3;
      appendError(
        {
          file,
          start: { line: lineNumber, column },
          end: { line: lineNumber, column: column + "ZIG_EXPORT(".length },
        },
        "ZIG_EXPORT found, but Lezer failed to parse the file.",
      );
    }
    return;
  }

  const queryFoundLines = new Set<number>();

  tree.iterate({
    enter: nodeRef => {
      if (nodeRef.name !== "FunctionDefinition") {
        return true; // Continue traversal
      }
      // console.log(
      //   `\n--- Found ZIG_EXPORT on function in ${file} at line ${lineInfo.get(nodeRef.node.from).line} ---\n`,
      // );
      // // Use the new pretty-printer to log the tree structure of the matched function
      // console.log(prettyPrintLezerNode(nodeRef.node, ctx.sourceCode));
      // console.log(`-------------------------------------------------------------------\n`);

      const fnNode = nodeRef.node;
      let zigExportAttr: SyntaxNode | null = null;
      let tagIdentifier: SyntaxNode | null = null;

      for (const attr of fnNode.getChildren("Attribute")) {
        const attrNameNode = attr.getChild("AttributeName");
        if (attrNameNode && text(attrNameNode, ctx) === "ZIG_EXPORT") {
          zigExportAttr = attr;
          const args = attr.getChild("AttributeArgs");
          if (args) {
            tagIdentifier = args.getChild("Identifier");
          }
          break;
        }
      }

      if (!zigExportAttr || !tagIdentifier) {
        return false; // Not an exported function, prune search
      }

      queryFoundLines.add(lineInfo.get(zigExportAttr.from).line);

      // disabled because lezer parses (extern "C") seperately to the function definition / block
      /* const linkage = closest(fnNode, "LinkageSpecification");
      const linkageString = linkage?.getChild("String");
      if (!linkage || !linkageString || text(linkageString, ctx) !== '"C"') {
        appendError(
          nodePosition(fnNode, ctx),
          'exported function must be extern "C":\n' +
            (linkage ? prettyPrintLezerNode(linkage, ctx.sourceCode) : "no linkage"),
        );
      } */

      const tagStr = text(tagIdentifier, ctx);
      let tag: ExportTag | undefined;
      if (
        tagStr === "nothrow" ||
        tagStr === "zero_is_throw" ||
        tagStr === "check_slow" ||
        tagStr === "false_is_throw" ||
        tagStr === "null_is_throw"
      ) {
        tag = tagStr;
      } else if (tagStr === "print") {
        console.log(prettyPrintLezerNode(fnNode, ctx.sourceCode));
        appendError(nodePosition(tagIdentifier, ctx), "'print' tags are only for debugging cppbind");
        tag = "nothrow";
      } else {
        appendError(
          nodePosition(tagIdentifier, ctx),
          "tag must be nothrow, zero_is_throw, check_slow, false_is_throw, or null_is_throw: " + tagStr,
        );
        tag = "nothrow";
      }

      try {
        const result = processFunction(ctx, fnNode, tag);
        allFunctions.push(result);
      } catch (e) {
        appendErrorFromCatch(e, nodePosition(fnNode, ctx));
      }

      return false; // Don't descend into function body
    },
  });

  for (const lineNumber of manualFindLines) {
    if (!queryFoundLines.has(lineNumber)) {
      const lineContent = sourceCodeLines[lineNumber - 1];
      const column = lineContent.indexOf("[[ZIG_EXPORT(") + 3;
      const position: Srcloc = {
        file,
        start: { line: lineNumber, column },
        end: { line: lineNumber, column: column + "ZIG_EXPORT(".length },
      };
      appendError(
        position,
        "ZIG_EXPORT was found on this line, but the Lezer parser did not find a valid C++ attribute on a function definition. Ensure it's in the form `[[ZIG_EXPORT(tag)]]` before a function definition.",
      );
    }
  }
}

async function renderError(position: Srcloc, message: string, label: string, color: string) {
  const fileContent = await Bun.file(position.file).text();
  const lines = fileContent.split("\n");
  const line = lines[position.start.line - 1];
  if (line === undefined) return;

  console.error(
    `\x1b[m${position.file}:${position.start.line}:${position.start.column}: ${color}\x1b[1m${label}:\x1b[m ${message}`,
  );
  const before = `${position.start.line} |   ${line.substring(0, position.start.column - 1)}`;
  const after = line.substring(position.start.column - 1);
  console.error(`\x1b[90m${before}${after}\x1b[m`);
  let length = position.start.line === position.end.line ? position.end.column - position.start.column : 1;
  console.error(`\x1b[m${" ".repeat(Bun.stringWidth(before))}${color}^${"~".repeat(Math.max(length - 1, 0))}\x1b[m`);
}

type Cfg = {
  dstDir: string;
};
function generateZigFn(
  fn: CppFn,
  resultRaw: string[],
  resultBindings: string[],
  resultSourceLinks: string[],
  cfg: Cfg,
): void {
  let returnType = generateZigType(fn.returnType, null);
  if (resultBindings.length) resultBindings.push("");
  resultBindings.push(generateZigSourceComment(cfg, resultSourceLinks, fn));
  if (fn.tag === "nothrow") {
    resultBindings.push(
      `pub extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${returnType};`,
    );
    return;
  }

  resultRaw.push(`    extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${returnType};`);
  let globalThisArg: CppParameter | undefined;
  for (const param of fn.parameters) {
    const type = generateZigType(param.type, null);
    if (type === "?*jsc.JSGlobalObject") {
      globalThisArg = param;
      break;
    }
  }
  if (!globalThisArg) throwError(fn.position, "no globalThis argument found (required for " + fn.tag + ")");
  if (fn.tag === "check_slow") {
    if (returnType === "jsc.JSValue") {
      appendError(
        fn.position,
        "Use ZIG_EXPORT(zero_is_throw) instead of ZIG_EXPORT(check_slow) for functions that return JSValue",
      );
    }
    resultBindings.push(
      `pub fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters, globalThisArg)}) error{JSError}!${returnType} {`,
      `    if (comptime Environment.ci_assert) {`,
      `        var scope: jsc.TopExceptionScope = undefined;`,
      `        scope.init(${formatZigName(globalThisArg.name)}, @src());`,
      `        defer scope.deinit();`,
      ``,
      `        const result = raw.${formatZigName(fn.name)}(${fn.parameters.map(p => formatZigName(p.name)).join(", ")});`,
      `        try scope.returnIfException();`,
      `        return result;`,
      `    } else {`,
      `        const result = raw.${formatZigName(fn.name)}(${fn.parameters.map(p => formatZigName(p.name)).join(", ")});`,
      `        if (Bun__RETURN_IF_EXCEPTION(${formatZigName(globalThisArg.name)})) return error.JSError;`,
      `        return result;`,
      `    }`,
      `}`,
    );
    return;
  }

  let equalsValue: string;
  if (fn.tag === "zero_is_throw") {
    equalsValue = ".zero";
    if (returnType !== "jsc.JSValue") {
      appendError(fn.position, "ZIG_EXPORT(zero_is_throw) is only allowed for functions that return JSValue");
    }
  } else if (fn.tag === "false_is_throw") {
    equalsValue = "false";
    if (returnType !== "bool") {
      appendError(fn.position, "ZIG_EXPORT(false_is_throw) is only allowed for functions that return bool");
    }
    returnType = "void";
  } else if (fn.tag === "null_is_throw") {
    equalsValue = "null";
    if (!returnType.startsWith("?*")) {
      appendError(fn.position, "ZIG_EXPORT(null_is_throw) is only allowed for functions that return optional pointer");
    }
    returnType = returnType.slice(1);
  } else assertNever(fn.tag);
  resultBindings.push(
    `pub fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters, globalThisArg)}) error{JSError}!${returnType} {`,
    `    if (comptime Environment.ci_assert) {`,
    `        var scope: jsc.ExceptionValidationScope = undefined;`,
    `        scope.init(${formatZigName(globalThisArg.name)}, @src());`,
    `        defer scope.deinit();`,
    ``,
    `        const value = raw.${formatZigName(fn.name)}(${fn.parameters.map(p => formatZigName(p.name)).join(", ")});`,
    `        scope.assertExceptionPresenceMatches(value == ${equalsValue});`,
    `        return if (value == ${equalsValue}) error.JSError ${fn.tag === "false_is_throw" ? "" : "else value"}${fn.tag === "null_is_throw" ? ".?" : ""};`,
    `    } else {`,
    `        const value = raw.${formatZigName(fn.name)}(${fn.parameters.map(p => formatZigName(p.name)).join(", ")});`,
    `        if (value == ${equalsValue}) return error.JSError;`,
    ...(fn.tag === "false_is_throw" ? [] : [`        return value${fn.tag === "null_is_throw" ? ".?" : ""};`]),
    `    }`,
    `}`,
  );
  return;
}

async function readFileOrEmpty(file: string): Promise<string> {
  try {
    const fileContents = await Bun.file(file).text();
    return fileContents;
  } catch (e) {
    return "";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dstDir = args[1];
  if (!dstDir) {
    console.error(
      String.raw`
                   _     _           _
                  | |   (_)         | |
   ___ _ __  _ __ | |__  _ _ __   __| |
  / __| '_ \| '_ \| '_ \| | '_ \ / _' |
 | (__| |_) | |_) | |_) | | | | | (_| |
  \___| .__/| .__/|_.__/|_|_| |_|\__,_|
      | |   | |
      |_|   |_|
`.slice(1),
    );
    console.error("Usage: bun src/codegen/cppbind src build/debug/codegen");
    process.exit(1);
  }
  await mkdir(dstDir, { recursive: true });

  const parser = cppParser;

  const allCppFiles = (await Bun.file("cmake/sources/CxxSources.txt").text())
    .trim()
    .split("\n")
    .map(q => q.trim())
    .filter(q => !!q)
    .filter(q => !q.startsWith("#"));

  const allFunctions: CppFn[] = [];
  await Promise.all(allCppFiles.map(file => processFile(parser, file, allFunctions)));
  allFunctions.sort((a, b) => (a.position.file < b.position.file ? -1 : a.position.file > b.position.file ? 1 : 0));

  const resultRaw: string[] = [];
  const resultBindings: string[] = [];
  const resultSourceLinks: string[] = [];
  for (const fn of allFunctions) {
    try {
      generateZigFn(fn, resultRaw, resultBindings, resultSourceLinks, { dstDir });
    } catch (e) {
      appendErrorFromCatch(e, fn.position);
    }
  }

  for (const message of errors) {
    await renderError(message.position, message.message, "error", "\x1b[31m");
    for (const note of message.notes) {
      await renderError(note.position, note.message, "note", "\x1b[36m");
    }
    console.error();
  }

  const resultFilePath = join(dstDir, "cpp.zig");
  const resultContents =
    typeDeclarations +
    "\n" +
    resultBindings.join("\n") +
    "\n\nconst raw = struct {\n" +
    resultRaw.join("\n") +
    "\n};\n";
  if ((await readFileOrEmpty(resultFilePath)) !== resultContents) {
    await Bun.write(resultFilePath, resultContents);
  }

  const resultSourceLinksFilePath = join(dstDir, "cpp.source-links");
  const resultSourceLinksContents = resultSourceLinks.join("\n");
  if ((await readFileOrEmpty(resultSourceLinksFilePath)) !== resultSourceLinksContents) {
    await Bun.write(resultSourceLinksFilePath, resultSourceLinksContents);
    const now = Date.now();
    const sin = Math.round(((Math.sin((now / 1000) * 1) + 1) / 2) * 0);
    if (process.env.CI) {
      console.log(
        " ".repeat(sin) +
          (errors.length > 0 ? "✗" : "✓") +
          " cppbind.ts generated bindings to " +
          resultFilePath +
          (errors.length > 0 ? " with errors" : "") +
          " in " +
          (now - start) +
          "ms",
      );
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run the main function
await main();
