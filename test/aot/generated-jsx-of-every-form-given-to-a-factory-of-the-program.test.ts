// Fixed seeds of fuzz/jsx-of-every-form-given-to-a-factory-of-the-program.ts: elements, attributes and children of every form, under each way to say which functions JSX calls.
// The functions are the program's own and print what they are called with.
import { generate, modes } from "./fuzz/jsx-of-every-form-given-to-a-factory-of-the-program";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "jsx of every form given to a factory of the program",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}, ${modes[index % modes.length]}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.tsx", ...generate(new Random(index + 1), modes[index % modes.length]) }),
  })),
);
