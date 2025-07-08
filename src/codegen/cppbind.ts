import { mkdir } from "fs/promises";
import { join, relative } from "path";
import { Parser, Language, Query, Node } from "web-tree-sitter";
import CppPath from "tree-sitter-cpp/tree-sitter-cpp.wasm";
import { sharedTypes, typeDeclarations } from "./shared-types";

// https://tree-sitter.github.io/tree-sitter/7-playground.html

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
    }
  | {
      type: "reference";
      child: CppType;
      position: Srcloc;
      isConst: boolean;
    }
  | {
      type: "named";
      name: string;
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
    return appendError(error.position, error.message);
  }
  if (error instanceof Error) {
    return appendError(position, error.message);
  }
  return appendError(position, "unknown error: " + JSON.stringify(error));
}
function throwError(position: Srcloc, message: string): never {
  throw new PositionedErrorClass(position, message);
}
function nodePosition(file: string, node: SyntaxNode): Srcloc {
  return {
    file,
    start: { line: node.startPosition.row + 1, column: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column + 1 },
  };
}
function assertNever(value: never): never {
  throw new Error("assertNever");
}
class PositionedErrorClass extends Error {
  constructor(
    public position: Srcloc,
    message: string,
  ) {
    super(message);
  }
}

function processRootmostType(file: string, types: SyntaxNode[]): CppType {
  const type = types[0];
  if (!type) throwError(nodePosition(file, types[0]), "no type found");
  return { type: "named", name: type.text, position: nodePosition(file, type) };
}

function processDeclarator(
  file: string,
  node: SyntaxNode,
  rootmostType?: CppType,
): { type: CppType; final: SyntaxNode } {
  // example: int* spiral() is:
  // type: primitive_type[int], declarator: pointer_declarator[ declarator: function_declarator[ declarator: identifier[spiral], parameters: parame

  const declarators = node.childrenForFieldName("declarator");
  const declarator = declarators[0];
  if (!declarator) throwError(nodePosition(file, declarators[0]), "no declarator found");

  rootmostType ??= processRootmostType(file, node.childrenForFieldName("type"));
  if (!rootmostType) throwError(nodePosition(file, node), "no rootmost type found");

  const isConst = node.children.some(child => child.type === "type_qualifier" && child.text === "const");
  if (declarator.type === "pointer_declarator") {
    return processDeclarator(file, declarator, {
      type: "pointer",
      child: rootmostType,
      position: nodePosition(file, declarator),
      isConst,
    });
  }
  if (declarator.type === "reference_declarator") {
    return processDeclarator(file, declarator, {
      type: "reference",
      child: rootmostType,
      position: nodePosition(file, declarator),
      isConst,
    });
  }
  return { type: rootmostType, final: declarator };
}

function processFunction(file: string, node: SyntaxNode, tag: ExportTag): CppFn {
  // void* spiral()

  const declarator = processDeclarator(file, node);
  if (!declarator) throwError(nodePosition(file, node.childrenForFieldName("declarator")[0]), "no declarator found");
  const final = declarator.final;
  if (final.type !== "function_declarator") {
    throwError(nodePosition(file, final), "not a function_declarator: " + final.type);
  }
  const name = final.childrenForFieldName("declarator")[0];
  if (!name) throwError(nodePosition(file, final.childrenForFieldName("declarator")[0]), "no name found");
  const parameterList = final.childrenForFieldName("parameters")[0];
  if (!parameterList || parameterList.type !== "parameter_list")
    throwError(nodePosition(file, final.childrenForFieldName("parameters")[0]), "no parameter list found");

  const parameters: CppParameter[] = [];
  for (const parameter of parameterList.children) {
    if (parameter.type !== "parameter_declaration") continue;

    const declarator = processDeclarator(file, parameter);
    if (!declarator)
      throwError(
        nodePosition(file, parameter.childrenForFieldName("declarator")[0]),
        "no declarator found for parameter",
      );
    const name = declarator.final;
    if (!name) throwError(nodePosition(file, parameter), "no name found for parameter");

    parameters.push({ type: declarator.type, name: name.text });
  }

  return {
    returnType: declarator.type,
    name: name.text,
    parameters,
    position: nodePosition(file, name),
    tag,
  };
}

type ExportTag = "check_slow" | "zero_is_throw" | "nothrow";
type ShouldExport = {
  value?: {
    tag: ExportTag;
    position: Srcloc;
  };
};

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
function generateZigType(type: CppType, subLevel?: boolean) {
  if (type.type === "pointer") {
    if (type.isConst) return `*const ${generateZigType(type.child, true)}`;
    return `*${generateZigType(type.child, true)}`;
  }
  if (type.type === "reference") {
    if (type.isConst) return `*const ${generateZigType(type.child, true)}`;
    return `*${generateZigType(type.child, true)}`;
  }
  if (type.type === "named" && type.name === "void") {
    if (subLevel) return "anyopaque";
    return "void";
  }
  if (type.type === "named") {
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
function generateZigParameterList(parameters: CppParameter[]): string {
  return parameters.map(p => `${formatZigName(p.name)}: ${generateZigType(p.type, false)}`).join(", ");
}
function generateZigSourceComment(dstDir: string, resultSourceLinks: string[], fn: CppFn): string {
  const fileName = relative(dstDir, fn.position.file);
  resultSourceLinks.push(`${fn.name}:${fileName}:${fn.position.start.line}:${fn.position.start.column}`);
  return `    /// Source: ${fn.name}`;
}

function closest(node: Node | null, type: string): Node | null {
  while (node) {
    if (node.type === type) return node;
    node = node.parent;
  }
  return null;
}

async function processFile(parserAndQueries: ParserAndQueries, file: string, allFunctions: CppFn[]) {
  const sourceCode = await Bun.file(file).text();
  if (!sourceCode.includes("ZIG_EXPORT")) return;
  const tree = parserAndQueries.parser.parse(sourceCode);
  if (!tree) return appendError({ file, start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, "no tree found");

  const matches = parserAndQueries.query.matches(tree.rootNode);

  for (const match of matches) {
    const identifierCapture = match.captures.find(c => c.name === "attribute.identifier");
    const fnCapture = match.captures.find(c => c.name === "fn");
    if (!identifierCapture || !fnCapture) continue;

    const linkage = closest(fnCapture.node, "linkage_specification");
    const value = linkage?.childrenForFieldName("value")[0];
    if (!linkage || value?.type !== "string_literal" || value.text !== '"C"') {
      appendError(nodePosition(file, fnCapture.node), 'exported function must be extern "C"');
    }

    const tagStr = identifierCapture.node.text;
    let tag: ExportTag | undefined;

    if (tagStr === "nothrow" || tagStr === "zero_is_throw" || tagStr === "check_slow") {
      tag = tagStr;
    } else {
      appendError(nodePosition(file, identifierCapture.node), "tag must be nothrow, zero_is_throw, or check_slow");
      tag = "nothrow";
    }

    try {
      const result = processFunction(file, fnCapture.node, tag);
      allFunctions.push(result);
    } catch (e) {
      appendErrorFromCatch(e, nodePosition(file, fnCapture.node));
    }
  }
  // processNode(file, cursor, allFunctions, {}, false, []);
}

async function renderError(position: Srcloc, message: string, label: string, color: string) {
  const fileContent = await Bun.file(position.file).text();
  const lines = fileContent.split("\n");
  const line = lines[position.start.line - 1];

  console.error(
    `\x1b[m${position.file}:${position.start.line}:${position.start.column}: ${color}\x1b[1m${label}:\x1b[m ${message}`,
  );
  const before = `${position.start.column} |   ${line.substring(0, position.start.column - 1)}`;
  const after = line.substring(position.start.column - 1);
  console.error(`\x1b[90m${before}${after}\x1b[m`);
  let length = position.start.line === position.end.line ? position.end.column - position.start.column : 1;
  console.error(`\x1b[m${" ".repeat(Bun.stringWidth(before))}${color}^${"~".repeat(Math.max(length - 1, 0))}\x1b[m`);
}

function generateZigFn(
  fn: CppFn,
  resultRaw: string[],
  resultBindings: string[],
  resultSourceLinks: string[],
  dstDir: string,
): void {
  if (fn.tag === "nothrow") {
    if (resultBindings.length) resultBindings.push("");
    resultBindings.push(
      generateZigSourceComment(dstDir, resultSourceLinks, fn),
      `    pub extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)};`,
    );
  } else if (fn.tag === "check_slow" || fn.tag === "zero_is_throw") {
    if (resultRaw.length) resultRaw.push("");
    if (resultBindings.length) resultBindings.push("");
    resultRaw.push(
      generateZigSourceComment(dstDir, resultSourceLinks, fn),
      `    extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)};`,
    );
    const globalThisArg = fn.parameters.find(param => generateZigType(param.type) === "*JSC.JSGlobalObject");
    if (!globalThisArg) throwError(fn.position, "no globalThis argument found");
    const callName = fn.tag === "check_slow" ? "fromJSHostCallGeneric" : "fromJSHostCall";
    resultBindings.push(
      `    pub inline fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) bun.JSError!${generateZigType(fn.returnType)} {`,
      `        return bun.JSC.${callName}(${formatZigName(globalThisArg.name)}, @src(), raw.${formatZigName(fn.name)}, .{ ${fn.parameters.map(p => formatZigName(p.name)).join(", ")} });`,
      `    }`,
    );
  } else assertNever(fn.tag);
}

async function readFileOrEmpty(file: string): Promise<string> {
  try {
    const fileContents = await Bun.file(file).text();
    return fileContents;
  } catch (e) {
    return "";
  }
}

type ParserAndQueries = {
  parser: Parser;
  query: Query;
};

async function main() {
  const args = process.argv.slice(2);
  const rootDir = args[0];
  const dstDir = args[1];
  if (!rootDir || !dstDir) {
    console.error("Usage: bun src/codegen/cppbind <rootDir> <dstDir>");
    process.exit(1);
  }
  await mkdir(dstDir, { recursive: true });

  await Parser.init();
  const Cpp = await Language.load(CppPath);

  const parser = new Parser();
  parser.setLanguage(Cpp as unknown as Language);
  const query = new Query(
    Cpp as unknown as Language,
    `(
      (function_definition
        (attribute_declaration
          (attribute
            name: (identifier) @attribute.name
            (#eq? @attribute.name "ZIG_EXPORT")
            (argument_list (identifier) @attribute.identifier)
          )
        )
      )
      @fn
    )`,
  );

  const allCppFiles = (await Bun.file("cmake/sources/CxxSources.txt").text())
    .trim()
    .split("\n")
    .map(q => q.trim())
    .filter(q => !!q)
    .filter(q => !q.startsWith("#"));

  const allFunctions: CppFn[] = [];
  for (const file of allCppFiles) {
    await processFile(
      {
        parser,
        query,
      },
      file,
      allFunctions,
    );
  }

  const resultRaw: string[] = [];
  const resultBindings: string[] = [];
  const resultSourceLinks: string[] = [];
  for (const fn of allFunctions) {
    try {
      generateZigFn(fn, resultRaw, resultBindings, resultSourceLinks, dstDir);
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
    "\nconst raw = struct {\n" +
    resultRaw.join("\n") +
    "\n};\n\npub const bindings = struct {\n" +
    resultBindings.join("\n") +
    "\n};\n";
  if ((await readFileOrEmpty(resultFilePath)) !== resultContents) {
    await Bun.write(resultFilePath, resultContents);
  }

  const resultSourceLinksFilePath = join(dstDir, "cpp.source-links");
  const resultSourceLinksContents = resultSourceLinks.join("\n");
  if ((await readFileOrEmpty(resultSourceLinksFilePath)) !== resultSourceLinksContents) {
    await Bun.write(resultSourceLinksFilePath, resultSourceLinksContents);
  }

  console.log(
    (errors.length > 0 ? "✗" : "✓") +
      " cppbind.ts generated bindings to " +
      resultFilePath +
      (errors.length > 0 ? " with errors" : ""),
  );
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run the main function
await main();

/*
TODO:
move the output into codegen, use @import("cpp")
*/
