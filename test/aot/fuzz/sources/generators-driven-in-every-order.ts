// Fixed seeds of fuzz/generators-driven-in-every-order.ts: generators and async generators with `yield` in `try`, `catch` and `finally` and `yield*` over everything, written in eight ways, driven by
// `next`, `return` and `throw` in every order, ahead of the first step, behind the end, from inside themselves, several requests at once, and by loops, spreads and patterns.
import { generate } from "../generators-driven-in-every-order";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "generators driven in every order",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
