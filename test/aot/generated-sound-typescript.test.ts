import { readFileSync } from "fs";
import { join } from "path";
import { generated } from "./generated/run-generated";

generated("sound TypeScript", [
  {
    name: "a catalogue of what programs write",
    isAlwaysRun: true,
    make: () => ({
      file: "main.ts",
      text: readFileSync(join(import.meta.dir, "programs", "language", "sound-typescript-never-rejected.ts"), "utf8"),
      files: {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            target: "ESNext",
            module: "Preserve",
            noEmit: true,
            lib: ["ESNext"],
            typeRoots: [join(import.meta.dir, "..", "..", "packages")],
            types: ["bun-types"],
          },
        }),
      },
    }),
  },
]);
