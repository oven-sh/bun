import * as lezerCpp from "@lezer/cpp";
import type { SyntaxNodeRef } from "@lezer/common";
import { readdir } from "fs/promises";
import { join } from "path";
import { sharedTypes } from "./shared-types";

const allSourceFiles = await readdir("src", { recursive: true });
const allCppFiles = allSourceFiles.filter(file => file.endsWith(".cpp"));

const parser = lezerCpp.parser;

const outputFile = "build/debug/codegen/cpp.zig";

type Zig = string | Zig[];
const outputTypes: Zig[] = [];
const outputRawBindings: Zig[] = [];
const outputBindings: Zig[] = [];
const addedTypes: Set<string> = new Set();

type CppType =
  | {
      type: "pointer";
      child: CppType;
      const: boolean;
    }
  | {
      type: "reference";
      child: CppType;
      const: boolean;
    }
  | {
      type: "type";
      name: string;
    };
type FunctionParam = {
  type: CppType;
  name: string;
  srcloc: Srcloc;
};

interface FunctionSignature {
  name: string;
  returnType: CppType;
  params: FunctionParam[];
  isExceptionJSValue: boolean;
  isCheckException: boolean;
  srcloc: Srcloc;
}

type Srcloc = {
  file: string;
  line: number;
  column: number;
};

type ReportedError = {
  message: string;
  srcloc: Srcloc;
};

const allErrors: ReportedError[] = [];

function getCppType(node: SyntaxNodeRef) {
  throw new Error("TODO: implement");
}

// Helper to convert C++ type to Zig type
function cppTypeToZig(
  cppType: string,
  srcloc: Srcloc,
  isPointer: boolean,
  isConst: boolean,
  isReference: boolean,
): string {
  // Clean up the type
  let cleanType = cppType.trim();

  // Handle namespace prefixes
  if (cleanType.startsWith("Inspector::")) {
    cleanType = cleanType.substring("Inspector::".length);
  }

  // Check if it's in our type map
  let zigType = sharedTypes[cleanType];

  if (!zigType) {
    // If not mapped, report an error
    zigType = `types.${cleanType}`;

    // Add to types if it looks like a class/struct
    if (cleanType.match(/^[A-Z][a-zA-Z0-9_]*$/)) {
      if (!addedTypes.has(cleanType)) {
        addedTypes.add(cleanType);
        outputTypes.push(`    pub const ${cleanType} = opaque {};\n`);
      }
    }
  }

  // Handle pointers and references
  if (isPointer) {
    // must use [*c] because we don't know if it is a single-item or many-item pointer
    if (isConst) {
      return `[*c]const ${zigType}`;
    } else {
      return `[*c]${zigType}`;
    }
  } else if (isReference) {
    if (isConst) {
      return `*const ${zigType}`;
    } else {
      return `*${zigType}`;
    }
  }

  return zigType;
}

// Process a single C++ file
async function processCppFile(filePath: string): Promise<FunctionSignature[]> {
  const input = await Bun.file(filePath).text();
  if (!input.includes("ZIG_EXPORT")) return []; // save time
  const functions: FunctionSignature[] = [];

  // Find extern "C" blocks first
  const externCBlocks: { start: number; end: number }[] = [];
  let inExternC = false;
  let externCStart = 0;

  const tree = parser.parse(input);

  tree.iterate({
    enter(node) {
      if (node.type.name === "LinkageSpecification") {
        const specText = input.slice(node.from, node.to);
        if (specText.includes('extern "C"')) {
          inExternC = true;
          externCStart = node.from;
        }
      }
    },
    leave(node) {
      if (node.type.name === "LinkageSpecification" && inExternC) {
        inExternC = false;
        externCBlocks.push({ start: externCStart, end: node.to });
      }
    },
  });

  // Now parse function definitions
  tree.iterate({
    enter(node) {
      if (node.type.name === "FunctionDefinition") {
        const functionNode = node.node;
        const funcStart = node.from;
        const funcEnd = node.to;

        // Check if this function is in an extern "C" block
        const isExternC = externCBlocks.some(block => funcStart >= block.start && funcEnd <= block.end);

        // Skip if not extern C
        if (!isExternC) return;

        // Check if this function has ZIG_EXPORT or ZIG_EXCEPTION_JSVALUE marker
        // Look for markers in the line(s) immediately before the function
        const searchStart = Math.max(0, funcStart - 200); // Look back up to 200 chars
        const precedingText = input.slice(searchStart, funcStart);
        const hasZigExport = precedingText.includes("ZIG_EXPORT");

        // Skip if not marked with ZIG_EXPORT
        if (!hasZigExport) return;

        const exceptionType = precedingText.includes("ZIG_EXPORT_ZEROISTHROW")
          ? "ZeroIsThrow"
          : precedingText.includes("ZIG_EXPORT_CHECKEXCEPTION_SLOW")
            ? "CheckException"
            : precedingText.includes("ZIG_EXPORT_NOTHROW")
              ? "NoThrow"
              : "error";
        if (exceptionType === "error") {
          console.error(`Error: ${filePath}:${funcStart}:${funcEnd} has no exception type`);
          process.exit(1);
        }

        // Calculate line and column from the function position
        const linesBefore = input.slice(0, funcStart).split("\n");
        const line = linesBefore.length;
        const column = linesBefore[linesBefore.length - 1].length + 1;

        let signature: FunctionSignature = {
          name: "",
          returnType: "void",
          params: [],
          srcloc: {
            file: filePath,
            line,
            column,
          },
          isExceptionJSValue: exceptionType === "ZeroIsThrow",
          isCheckException: exceptionType === "CheckException",
        };

        // TODO: parse the argument types and return type

        // Add the function to our list
        if (signature.name) {
          functions.push(signature);
        }
      }
    },
  });

  return functions;
}

// Process all C++ files
console.log(`Processing ${allCppFiles.length} C++ files...`);

let totalFunctions = 0;

for (const cppFile of allCppFiles) {
  const filePath = join("src", cppFile);

  try {
    const functions = await processCppFile(filePath);

    if (functions.length > 0) {
      // Group functions by source file for organized output
      const fileBindings: Zig[] = [];

      // Generate Zig extern declarations
      functions.forEach(func => {
        const params = func.params
          .map(param => {
            const zigType = cppTypeToZig(param.type, param.srcloc, param.isPointer, param.isConst, param.isReference);
            return `${param.name}: ${zigType}`;
          })
          .join(", ");

        const returnType = cppTypeToZig(
          func.returnType,
          {
            file: filePath,
            line: func.line,
            column: func.column,
          },
          false,
          false,
          false,
        );

        if (func.isExceptionJSValue) {
          outputRawBindings.push(`    /// Source: ../../../${filePath}:${func.line}:${func.column}\n`);
          outputRawBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);

          // Generate wrapper function for exception handling
          const wrapperParams = func.params
            .map(
              param =>
                `${param.name}: ${cppTypeToZig(param.type, param.srcloc, param.isPointer, param.isConst, param.isReference)}`,
            )
            .join(", ");

          // Find the globalThis parameter name (should be first parameter of type JSGlobalObject)
          const globalThisParam = func.params.find(
            p => p.type === "JSC::JSGlobalObject" || p.type === "JSGlobalObject",
          );
          const globalThisName = globalThisParam ? globalThisParam.name : "globalThis";

          fileBindings.push(`    pub fn ${func.name}(${wrapperParams}) !JSC.JSValue {\n`);
          fileBindings.push(`        var scope: bun.JSC.CatchScope = undefined;\n`);
          fileBindings.push(`        scope.init(${globalThisName}, @src(), .assertions_only);\n`);
          fileBindings.push(`        defer scope.deinit();\n`);
          fileBindings.push(`        const value = raw.${func.name}(${func.params.map(p => p.name).join(", ")});\n`);
          fileBindings.push(`        scope.assertExceptionPresenceMatches(value == .zero);\n`);
          fileBindings.push(`        return if (value == .zero) error.JSError else value;\n`);
          fileBindings.push(`    }\n`);
        } else if (func.isCheckException) {
          outputRawBindings.push(`    /// Source: ${filePath}:${func.line}:${func.column}\n`);
          outputRawBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);

          // Generate wrapper function for ZIG_EXPORT_CHECKEXCEPTION_SLOW
          const wrapperParams = func.params
            .map(
              param =>
                `${param.name}: ${cppTypeToZig(param.type, param.srcloc, param.isPointer, param.isConst, param.isReference)}`,
            )
            .join(", ");

          // Find the globalThis parameter name (should be first parameter of type JSGlobalObject)
          const globalThisParam = func.params.find(
            p => p.type === "JSC::JSGlobalObject" || p.type === "JSGlobalObject",
          );
          const globalThisName = globalThisParam ? globalThisParam.name : "globalThis";

          fileBindings.push(`    pub fn ${func.name}(${wrapperParams}) !${returnType} {\n`);
          fileBindings.push(`        var scope: bun.JSC.CatchScope = undefined;\n`);
          fileBindings.push(`        scope.init(${globalThisName}, @src(), .assertions_only);\n`);
          fileBindings.push(`        defer scope.deinit();\n`);
          fileBindings.push(`        const result = raw.${func.name}(${func.params.map(p => p.name).join(", ")});\n`);
          fileBindings.push(`        try scope.returnIfException();\n`);
          fileBindings.push(`        return result;\n`);
          fileBindings.push(`    }\n`);
        } else {
          // Regular ZIG_EXPORT function
          fileBindings.push(`    /// Source: ${filePath}:${func.line}:${func.column}\n`);
          fileBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);
        }
      });

      fileBindings.push("\n");

      outputBindings.push(fileBindings);

      totalFunctions += functions.length;
      const exportCount = functions.filter(f => !f.isExceptionJSValue && !f.isCheckException).length;
      const exceptionCount = functions.filter(f => f.isExceptionJSValue).length;
      const checkExceptionCount = functions.filter(f => f.isCheckException).length;

      const parts: Zig[] = [];
      if (exportCount > 0) parts.push(`${exportCount} ZIG_EXPORT`);
      if (exceptionCount > 0) parts.push(`${exceptionCount} ZIG_EXPORT_ZEROISTHROW`);
      if (checkExceptionCount > 0) parts.push(`${checkExceptionCount} ZIG_EXPORT_CHECKEXCEPTION_SLOW`);

      if (parts.length > 0) {
        console.log(`  - ${cppFile}: ${parts.join(", ")} functions`);
      }
    }
  } catch (error) {
    console.error(`Error processing ${filePath}: ${error}`);
  }
}

const output: Zig = [
  "//! Generated by cppbind.ts\n",
  "\n",
  'const std = @import("std");\n',
  'const bun = @import("bun");\n',
  "const JSC = bun.JSC;\n",
  "const BunString = bun.String;\n",
  "\n",
  "pub const types = struct {\n",
  outputTypes,
  "};\n",
  "\n",
  outputRawBindings.length > 0 ? ["pub const raw = struct {\n", outputRawBindings, "};\n", "\n"] : [],
  "pub const bindings = struct {\n",
  outputBindings,
  "};\n",
];

const outputContent = output.flat(Infinity as 0).join("");
await Bun.write(outputFile, outputContent);

console.log(`\nTotal functions found: ${totalFunctions}`);
console.log(`Generated Zig bindings written to: ${outputFile}`);
