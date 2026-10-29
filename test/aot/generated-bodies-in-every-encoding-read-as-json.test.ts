// Fixed seeds of fuzz/bodies-in-every-encoding-read-as-json.ts: bytes that are JSON, nearly JSON or no UTF-8, with and without a byte order mark, held by a Request, a Response, a Blob or a stream,
// read by json() into declared types, into `unknown`, and by hand.
import { generate } from "./fuzz/bodies-in-every-encoding-read-as-json";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a body answers as in plain Bun whoever holds it and whatever type it is read into",
  Array.from({ length: 40 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index < 20,
    isOnlyCompiled: true as const,
    flags: [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(index + 1)),
      files: {},
    }),
  })),
);
