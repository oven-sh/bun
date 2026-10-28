// Fixed seeds of fuzz/generators-driven-in-every-order.ts: generators and async generators with `yield` in `try`, `catch` and `finally` and `yield*` over everything, written in eight ways, driven by
// `next`, `return` and `throw` in every order, ahead of the first step, behind the end, from inside themselves, several requests at once, and by loops, spreads and patterns.
import { generate } from "./fuzz/generators-driven-in-every-order";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "generators driven in every order",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
