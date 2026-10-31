// Fixed seeds of fuzz/default-exports-that-the-run-time-may-serve.ts: the default export of the entry point may be the configuration of a server.
// Its members are data, methods or getters that print, on the object or above it, or behind a Proxy that prints each read. The executable reads
// them as often and in the order in which plain Bun reads them, serves where plain Bun serves, and ends as plain Bun ends.
import { generate } from "../default-exports-that-the-run-time-may-serve";
import { Random } from "../random";
import { family } from "../family";

const onceWrong = [19, 28, 32, 54, 74, 107, 111, 112, 114, 115, 135, 144];

export default family(
  "default exports that the run time may serve are read as in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-heat=everything-is-hot"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => generate(new Random(index + 1)),
  })),
);
