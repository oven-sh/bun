import Parser, { Language, SyntaxNode } from "tree-sitter";
import Cpp from "tree-sitter-cpp";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { sharedTypes, typeDeclarations } from "./shared-types";

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
    }
  | {
      type: "reference";
      child: CppType;
      position: Srcloc;
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
  declarators: SyntaxNode[],
  rootmostType: CppType,
): { type: CppType; final: SyntaxNode } {
  // example: int* spiral() is:
  // type: primitive_type[int], declarator: pointer_declarator[ declarator: function_declarator[ declarator: identifier[spiral], parameters: parame

  const declarator = declarators[0];
  if (!declarator) throwError(nodePosition(file, declarators[0]), "no declarator found");
  if (declarator.type === "pointer_declarator") {
    const children = declarator.childrenForFieldName("declarator");
    return processDeclarator(file, children, {
      type: "pointer",
      child: rootmostType,
      position: nodePosition(file, declarator),
    });
  }
  if (declarator.type === "reference_declarator") {
    const children = declarator.childrenForFieldName("declarator");
    return processDeclarator(file, children, {
      type: "reference",
      child: rootmostType,
      position: nodePosition(file, declarator),
    });
  }
  return { type: rootmostType, final: declarator };
}

function processFunction(file: string, node: SyntaxNode, tag: ExportTag): CppFn {
  // void* spiral()

  const type: CppType = processRootmostType(file, node.childrenForFieldName("type"));
  if (!type) throwError(nodePosition(file, node.childrenForFieldName("type")[0]), "no type found");
  const declarator = processDeclarator(file, node.childrenForFieldName("declarator"), type);
  if (!declarator) throwError(nodePosition(file, node.childrenForFieldName("declarator")[0]), "no declarator found");
  const final = declarator.final;
  if (final.type !== "function_declarator") {
    const hasFunctionDeclarator = final.closest("function_declarator");
    if (hasFunctionDeclarator) {
      throwError(nodePosition(file, final), "final type is not a function_declarator (but it has one): " + final.type);
    }
    throwError(nodePosition(file, final), "no function_declarator found. final was: " + final.type);
  }
  const name = final.childrenForFieldName("declarator")[0];
  if (!name) throwError(nodePosition(file, final.childrenForFieldName("declarator")[0]), "no name found");
  const parameterList = final.childrenForFieldName("parameters")[0];
  if (!parameterList || parameterList.type !== "parameter_list")
    throwError(nodePosition(file, final.childrenForFieldName("parameters")[0]), "no parameter list found");

  const parameters: CppParameter[] = [];
  for (const parameter of parameterList.children) {
    if (parameter.type !== "parameter_declaration") continue;

    const type: CppType = processRootmostType(file, parameter.childrenForFieldName("type"));
    if (!type) throwError(nodePosition(file, parameter.childrenForFieldName("type")[0]), "no type found for parameter");
    const declarator = processDeclarator(file, parameter.childrenForFieldName("declarator"), type);
    if (!declarator)
      throwError(
        nodePosition(file, parameter.childrenForFieldName("declarator")[0]),
        "no declarator found for parameter",
      );
    const name = declarator.final;
    if (!name) throwError(nodePosition(file, parameter), "no name found for parameter");

    parameters.push({ type, name: name.text });
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
function processNode(
  file: string,
  node: SyntaxNode,
  allFunctions: CppFn[],
  shouldExport: ShouldExport,
  isInExternC: boolean,
  usingNamespaces: string[],
) {
  if (node.type === "function_definition" && shouldExport.value) {
    if (!isInExternC) {
      appendError(nodePosition(file, node), "@zig-export-ed function is not in extern C");
      return;
    }
    try {
      const result = processFunction(file, node, shouldExport.value.tag);
      allFunctions.push(result);
    } catch (e) {
      if (e instanceof PositionedErrorClass) {
        appendError(e.position, e.message);
      } else {
        appendError(nodePosition(file, node), "error processing function: " + (e as Error).message);
      }
    }
    shouldExport.value = undefined;
  } else {
    if (node.type === "linkage_specification") {
      const value = node.childrenForFieldName("value")[0];
      if (value && value.type === "string_literal" && value.text === '"C"') {
        isInExternC = true;
      }
    }

    for (const child of node.children) {
      if (child.type === "using_declaration") {
        const identifiers = child.descendantsOfType("identifier");
        if (identifiers.length !== 1) continue;
        usingNamespaces = [...usingNamespaces, identifiers[0].text];
      }
    }

    const hadShouldExport = !!shouldExport.value;
    for (const child of node.children) {
      if (child.type === "comment" && child.text.includes("@zig-export")) {
        const text = child.text;
        if (shouldExport.value) appendError(nodePosition(file, child), "multiple @zig-export comments in a row");
        if (text.includes("checkexception_slow")) {
          shouldExport.value = { tag: "check_slow", position: nodePosition(file, child) };
        } else if (text.includes("zero_is_throw")) {
          shouldExport.value = { tag: "zero_is_throw", position: nodePosition(file, child) };
        } else if (text.includes("nothrow")) {
          shouldExport.value = { tag: "nothrow", position: nodePosition(file, child) };
        } else {
          appendError(nodePosition(file, child), "unknown @zig-export comment: " + text);
        }
      } else {
        processNode(file, child, allFunctions, shouldExport, isInExternC, usingNamespaces);
        if (shouldExport.value && !hadShouldExport) {
          appendError(shouldExport.value.position, "unused @zig-export comment");
          shouldExport.value = undefined;
        }
      }
    }
    if (shouldExport.value && !hadShouldExport) {
      appendError(shouldExport.value.position, "unused @zig-export comment");
      shouldExport.value = undefined;
    }
  }
}

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
function generateZigType(type: CppType) {
  if (type.type === "pointer") {
    return `[*c]${generateZigType(type.child)}`;
  }
  if (type.type === "reference") {
    return `*${generateZigType(type.child)}`;
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
  return parameters.map(p => `${formatZigName(p.name)}: ${generateZigType(p.type)}`).join(", ");
}
function generateZigSourceComment(dstDir, fn: CppFn): string {
  return `    /// Source: ${relative(dstDir, fn.position.file)}:${fn.position.start.line}:${fn.position.start.column}`;
}

async function processFile(parser: Parser, file: string, allFunctions: CppFn[]) {
  const sourceCode = await Bun.file(file).text();
  if (!sourceCode.includes("@zig-export")) return;
  const tree = parser.parse(sourceCode);

  processNode(file, tree.rootNode, allFunctions, {}, false, []);
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

async function main() {
  const args = process.argv.slice(2);
  const rootDir = args[0];
  const dstDir = args[1];
  if (!rootDir || !dstDir) {
    console.error("Usage: bun src/codegen/cppbind <rootDir> <dstDir>");
    process.exit(1);
  }

  const parser = new Parser();
  parser.setLanguage(Cpp as unknown as Language);

  const allSourceFiles = await readdir(rootDir, { recursive: true });
  const allCppFiles = allSourceFiles.filter(file => file.endsWith(".cpp")).map(file => join(rootDir, file));

  const allFunctions: CppFn[] = [];
  for (const file of allCppFiles) {
    await processFile(parser, file, allFunctions);
  }

  const resultRaw: string[] = [];
  const resultBindings: string[] = [];
  for (const fn of allFunctions) {
    if (fn.tag === "nothrow") {
      if (resultBindings.length) resultBindings.push("");
      resultBindings.push(
        generateZigSourceComment(dstDir, fn),
        `    pub extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)};`,
      );
    } else if (fn.tag === "check_slow") {
      if (resultRaw.length) resultRaw.push("");
      if (resultBindings.length) resultBindings.push("");
      resultRaw.push(
        generateZigSourceComment(dstDir, fn),
        `    extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)};`,
      );
      resultBindings.push(
        `    pub fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)} {`,
        `        bun.JSC.fromJSHostCallGeneric(raw.${formatZigName(fn.name)}, .{ ${fn.parameters.map(p => formatZigName(p.name)).join(", ")}});`,
        `    }`,
      );
    } else if (fn.tag === "zero_is_throw") {
      if (resultRaw.length) resultRaw.push("");
      if (resultBindings.length) resultBindings.push("");
      resultRaw.push(
        generateZigSourceComment(dstDir, fn),
        `    extern fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)};`,
      );
      resultBindings.push(
        `    pub fn ${formatZigName(fn.name)}(${generateZigParameterList(fn.parameters)}) ${generateZigType(fn.returnType)} {`,
        `        bun.JSC.fromJSHostCall(raw.${formatZigName(fn.name)}, .{ ${fn.parameters.map(p => formatZigName(p.name)).join(", ")}});`,
        `    }`,
      );
    } else assertNever(fn.tag);
  }

  for (const message of errors) {
    await renderError(message.position, message.message, "error", "\x1b[31m");
    for (const note of message.notes) {
      await renderError(note.position, note.message, "note", "\x1b[36m");
    }
    console.error();
  }

  const resultFile = await Bun.file(join(dstDir, "cpp.zig"));
  await resultFile.write(
    typeDeclarations +
      "\nconst raw = struct {\n" +
      resultRaw.join("\n") +
      "\n};\n\npub const bindings = struct {\n" +
      resultBindings.join("\n") +
      "\n};\n",
  );

  console.log(
    (errors.length > 0 ? "✗" : "✓") +
      " cppbind.ts generated bindings to " +
      join(dstDir, "cpp.zig") +
      (errors.length > 0 ? " with errors" : ""),
  );
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run the main function
await main();
