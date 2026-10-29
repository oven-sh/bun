// fuzz/ways-out-of-blocks-loops-and-finally.ts: labeled blocks, loops, `switch` and `try` inside each other, left by `break`, `continue`, `return` and `throw`, also out of `finally`,
// in functions, generators and async functions. Each function is called twelve times and takes another road each time. They print every step on the road.
import { Random } from "../random";
import { generate, kinds } from "../ways-out-of-blocks-loops-and-finally";
import { endless } from "../family";

export default endless("ways out of blocks, loops and finally", index => ({
  name: `seed ${index + 1}, ${kinds[index % kinds.length]}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1), kinds[index % kinds.length]) }),
}));
