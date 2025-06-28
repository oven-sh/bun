import * as lezerCpp from "@lezer/cpp";
import { readdir } from "fs/promises";

const allSourceFiles = await readdir("src");
const allCppFiles = allSourceFiles.filter(file => file.endsWith(".cpp"));
const allZigFiles = allSourceFiles.filter(file => file.endsWith(".zig"));
const allUsedIdentifiers = new Set<string>();
for (const zigFile of allZigFiles) {
  const contents = await Bun.file(`src/${zigFile}`).text();
  for (const identifier of contents.split(/\b/)) {
    if (identifier.match(/^[A-Z][a-zA-Z0-9_]*$/)) {
      allUsedIdentifiers.add(identifier);
    }
  }
}
console.log(allZigFiles.length);

const parser = lezerCpp.parser;

const inputFile = "src/bun.js/bindings/InspectorHTTPServerAgent.cpp";
const trimmedOutputFile = "build/debug/codegen/cpp_min.zig";
const fullOutputFile = "build/debug/codegen/cpp_full.zig";

const input = await Bun.file(inputFile).text();

type Zig = string | Zig[];
const output: Zig[] = [];
const outputTypes: Zig[] = [];
const outputBindings: Zig[] = [];

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
  "JSC::JSValue": "JSC.JSValue",
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
      if (!outputTypes.some(t => typeof t === "string" && t.includes(`pub const ${cleanType} = opaque`))) {
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

// Parse function signatures from the tree
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

      let signature: FunctionSignature = {
        name: "",
        returnType: "void",
        params: [],
        isExternC: true,
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

      // Only add if we found a function name starting with Bun__
      if (signature.name && signature.name.startsWith("Bun__")) {
        functions.push(signature);
      }
    }
  },
});

// Generate Zig extern declarations
functions.forEach(func => {
  const params = func.params
    .map(param => {
      const zigType = cppTypeToZig(param.type, param.isPointer, param.isConst, param.isReference);
      return `${param.name}: ${zigType}`;
    })
    .join(", ");

  const returnType = cppTypeToZig(func.returnType, false, false, false);

  outputBindings.push(`    extern fn ${func.name}(${params}) ${returnType};\n`);
});

// Build final output
output.push(
  "// Generated by cppbind.ts\n",
  "// Source: ",
  inputFile,
  "\n\n",
  'const std = @import("std");\n',
  'const bun = @import("bun");\n',
  "const JSC = bun.JSC;\n",
  "const BunString = bun.String;\n",
  "\n",
  "pub const types = struct {\n",
  outputTypes,
  "};\n",
  "\n",
  "pub const bindings = struct {\n",
  outputBindings,
  "};\n",
);

console.log(`Found ${functions.length} extern "C" functions:`);
functions.forEach(func => {
  console.log(`  - ${func.name}`);
});

const outputContent = output.flat(Infinity as 0).join("");
await Bun.write(fullOutputFile, outputContent);
console.log(`\nGenerated Zig bindings written to: ${fullOutputFile}`);
