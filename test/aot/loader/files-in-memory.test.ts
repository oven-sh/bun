// The `files` of `Bun.build` come before the files on the disk.
import { buildBothWays } from "../build-both-ways";

buildBothWays("compile/aot/files in memory", {
  "an extension that is tried earlier, in memory": {
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.js": `export const a = "disk";` },
    options: `files: { [join(folder, "a.ts")]: "export const a: string = 'memory';" }`,
    // Without `aot` an import finds a file in memory only by its whole name.
    differs: { stdout: "memory\n" },
  },
  "the same name, in memory": {
    files: { "main.ts": `import { a } from "./a.ts"; console.log(a);`, "a.ts": `export const a: string = "disk";` },
    options: `files: { [join(folder, "a.ts")]: "export const a: string = 'memory';" }`,
    prints: "memory\n",
  },
  "a folder that is only in memory imports what is on the disk": {
    files: {
      "main.ts": `import { b } from "./memory/b.ts"; console.log(b);`,
      "a.ts": `export const a: string = "disk";`,
    },
    options: `files: { [join(folder, "memory/b.ts")]: "import { a } from '../a.ts'; export const b = a + ' through memory';" }`,
    prints: "disk through memory\n",
  },
});
