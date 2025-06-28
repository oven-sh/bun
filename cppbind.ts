import * as lezerCpp from "@lezer/cpp";
import { readdir } from "fs/promises";
import { join } from "path";

const allSourceFiles = await readdir("src", { recursive: true });
const allCppFiles = allSourceFiles.filter(file => file.endsWith(".cpp"));

const parser = lezerCpp.parser;

const outputFile = "build/debug/codegen/cpp.zig";

type Zig = string | Zig[];
const outputTypes: Zig[] = [];
const outputRawBindings: Zig[] = [];
const outputBindings: Zig[] = [];
const addedTypes: Set<string> = new Set();

// Map C++ types to Zig types
const typeMap: Record<string, string> = {
  // Basic types
  "void": "void",
  "bool": "bool",
  "char": "u8",
  "unsigned char": "u8",
  "signed char": "i8",
  "short": "i16",
  "unsigned short": "u16",
  "int": "c_int",
  "unsigned int": "c_uint",
  "long": "c_long",
  "unsigned long": "c_ulong",
  "long long": "i64",
  "unsigned long long": "u64",
  "float": "f32",
  "double": "f64",
  "size_t": "usize",
  "ssize_t": "isize",
  "int8_t": "i8",
  "uint8_t": "u8",
  "int16_t": "i16",
  "uint16_t": "u16",
  "int32_t": "i32",
  "uint32_t": "u32",
  "int64_t": "i64",
  "uint64_t": "u64",

  // Common Bun types
  "BunString": "BunString",
  "JSC::EncodedJSValue": "JSC.EncodedJSValue",
  "JSC::JSGlobalObject": "JSC.JSGlobalObject",
};

interface FunctionParam {
  type: string;
  name: string;
  isPointer: boolean;
  isConst: boolean;
  isReference: boolean;
}

interface FunctionSignature {
  name: string;
  returnType: string;
  params: FunctionParam[];
  isExternC: boolean;
  sourceFile: string;
  isExceptionJSValue: boolean;
}

// Helper to convert C++ type to Zig type
function cppTypeToZig(cppType: string, isPointer: boolean, isConst: boolean, isReference: boolean): string {
  // Clean up the type
  let cleanType = cppType.trim();

  // Handle namespace prefixes
  if (cleanType.startsWith("Inspector::")) {
    cleanType = cleanType.substring("Inspector::".length);
  }

  // Check if it's in our type map
  let zigType = typeMap[cleanType];

  if (!zigType) {
    // If not mapped, assume it's an opaque type that needs to be defined
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
  if (isPointer || isReference) {
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
        const hasZigExceptionJSValue = precedingText.includes("ZIG_EXCEPTION_JSVALUE");

        // Skip if not marked with either ZIG_EXPORT or ZIG_EXCEPTION_JSVALUE
        if (!hasZigExport && !hasZigExceptionJSValue) return;

        let signature: FunctionSignature = {
          name: "",
          returnType: "void",
          params: [],
          isExternC: true,
          sourceFile: filePath,
          isExceptionJSValue: hasZigExceptionJSValue,
        };

        // Parse the function
        let cursor = functionNode.firstChild;
        let returnTypeNodes: any[] = [];

        while (cursor) {
          if (cursor.type.name === "FunctionDeclarator") {
            // Parse function name and parameters
            let declaratorCursor = cursor.firstChild;

            while (declaratorCursor) {
              if (declaratorCursor.type.name === "Identifier") {
                signature.name = input.slice(declaratorCursor.from, declaratorCursor.to);
              } else if (declaratorCursor.type.name === "ParameterList") {
                // Parse parameters
                let paramCursor = declaratorCursor.firstChild;

                while (paramCursor) {
                  if (paramCursor.type.name === "ParameterDeclaration") {
                    let param: FunctionParam = {
                      type: "",
                      name: "",
                      isPointer: false,
                      isConst: false,
                      isReference: false,
                    };

                    // Parse parameter
                    const paramText = input.slice(paramCursor.from, paramCursor.to);

                    // Simple parsing - this could be more sophisticated
                    param.isConst = paramText.includes("const ");
                    param.isPointer = paramText.includes("*");
                    param.isReference = paramText.includes("&");

                    // Extract type and name (simplified)
                    let cleanParam = paramText
                      .replace(/const\s+/g, "")
                      .replace(/\*/g, "")
                      .replace(/&/g, "")
                      .trim();
                    const parts = cleanParam.split(/\s+/);

                    if (parts.length >= 2) {
                      param.type = parts.slice(0, -1).join(" ");
                      param.name = parts[parts.length - 1];
                    } else if (parts.length === 1) {
                      param.type = parts[0];
                      param.name = `arg${signature.params.length}`;
                    }

                    if (param.type) {
                      signature.params.push(param);
                    }
                  }
                  paramCursor = paramCursor.nextSibling;
                }
              }
              declaratorCursor = declaratorCursor.nextSibling;
            }
          } else if (cursor.type.name !== "CompoundStatement") {
            // Collect return type nodes
            returnTypeNodes.push(cursor);
          }
          cursor = cursor.nextSibling;
        }

        // Parse return type
        if (returnTypeNodes.length > 0) {
          const returnTypeText = returnTypeNodes
            .map(node => input.slice(node.from, node.to))
            .join(" ")
            .trim();

          if (returnTypeText && returnTypeText !== "void") {
            signature.returnType = returnTypeText;
          }
        }

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
            const zigType = cppTypeToZig(param.type, param.isPointer, param.isConst, param.isReference);
            return `${param.name}: ${zigType}`;
          })
          .join(", ");

        const returnType = cppTypeToZig(func.returnType, false, false, false);

        if (func.isExceptionJSValue) {
          outputRawBindings.push(`    /// Source: ${filePath}\n`);
          outputRawBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);

          // Generate wrapper function for exception handling
          const wrapperParams = func.params
            .map(
              param => `${param.name}: ${cppTypeToZig(param.type, param.isPointer, param.isConst, param.isReference)}`,
            )
            .join(", ");

          // Find the globalThis parameter name (should be first parameter of type JSGlobalObject)
          const globalThisParam = func.params.find(
            p => p.type === "JSC::JSGlobalObject" || p.type === "JSGlobalObject",
          );
          const globalThisName = globalThisParam ? globalThisParam.name : "globalThis";

          fileBindings.push(`    pub fn ${func.name}(${wrapperParams}) !JSC.JSValue {\n`);
          fileBindings.push(`        var scope: bun.JSC.CatchScope = undefined;\n`);
          fileBindings.push(`        scope.init(${globalThisName}, .assertions_only);\n`);
          fileBindings.push(`        defer scope.deinit();\n`);
          fileBindings.push(`        const value = raw.${func.name}(${func.params.map(p => p.name).join(", ")});\n`);
          fileBindings.push(`        scope.assertExceptionPresenceMatches(value == .zero);\n`);
          fileBindings.push(`        return if (value == .zero) error.JSError else value;\n`);
          fileBindings.push(`    }\n`);
        } else {
          // Regular ZIG_EXPORT function
          fileBindings.push(`    /// Source: ${filePath}\n`);
          fileBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);
        }
      });

      fileBindings.push("\n");

      outputBindings.push(fileBindings);

      totalFunctions += functions.length;
      const exportCount = functions.filter(f => !f.isExceptionJSValue).length;
      const exceptionCount = functions.filter(f => f.isExceptionJSValue).length;

      if (exportCount > 0 && exceptionCount > 0) {
        console.log(`  - ${cppFile}: ${exportCount} ZIG_EXPORT, ${exceptionCount} ZIG_EXCEPTION_JSVALUE functions`);
      } else if (exportCount > 0) {
        console.log(`  - ${cppFile}: ${exportCount} ZIG_EXPORT functions`);
      } else {
        console.log(`  - ${cppFile}: ${exceptionCount} ZIG_EXCEPTION_JSVALUE functions`);
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
