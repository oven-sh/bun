// fuzz/a-conditional-yields-an-object-literal-or-an-empty-one.ts: `test ? { key: value } : {}`, spread, nested, returned, kept or given to a call, in TypeScript and in JavaScript.
import { generate } from "../a-conditional-yields-an-object-literal-or-an-empty-one";
import { Random } from "../random";
import { endless } from "../family";

export default endless("a conditional yields an object literal or an empty one", index => {
  const isTyped = index % 2 === 0;
  return {
    name: `seed ${index + 1}${isTyped ? ", typed" : ""}.`,
    // Every second pair is built with every pass verified.
    flags: index % 4 >= 2 ? ["--aot-verify-each-pass", "--aot-check=validate-references"] : [],
    make: () => ({ file: isTyped ? "main.ts" : "main.mjs", text: generate(new Random(index + 1), isTyped) }),
  };
});
