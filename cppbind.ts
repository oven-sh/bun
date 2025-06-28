import * as lezerCpp from "@lezer/cpp";

const parser = lezerCpp.parser;

const input = await Bun.file("src/bun.js/bindings/InspectorHTTPServerAgent.cpp").text();

type Zig = string | Zig[];
const output: Zig[] = [];
const outputTypes: Zig[] = [];
const outputBindings: Zig[] = [];

output.push(
  "const types = struct {\n",
  outputTypes,
  "};\n",
  "\n",
  "pub const bindings = struct {\n",
  outputBindings,
  "};\n",
);

const tree = parser.parse(input);

// Walk the tree to find function definitions
const functionNames: string[] = [];

tree.iterate({
  enter(node) {
    // Check if this is a function definition
    if (node.type.name === "FunctionDefinition") {
      // Find the function name within this definition
      const functionNode = node.node;
      let cursor = functionNode.firstChild;

      while (cursor) {
        if (cursor.type.name === "FunctionDeclarator") {
          // Look for the identifier within the declarator
          let declaratorCursor = cursor.firstChild;
          while (declaratorCursor) {
            if (declaratorCursor.type.name === "Identifier") {
              const functionName = input.slice(declaratorCursor.from, declaratorCursor.to);
              functionNames.push(functionName);
              break;
            }
            declaratorCursor = declaratorCursor.nextSibling;
          }
          break;
        }
        cursor = cursor.nextSibling;
      }
    }
  },
});

console.log("Functions found in the file:");
functionNames.forEach(name => console.log(`  - ${name}`));
console.log(`\nTotal functions: ${functionNames.length}`);

await Bun.write("src/cpp.zig", output.flat(Infinity as 0).join(""));
