// console.Console, process._rawDebug() and process.loadEnvFile() format and parse as node:util does, in a program that never imports it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lines: string[] = [];
const sink = { write(text: string) { lines.push(text); return true; }, listenerCount: () => 0, once() {}, removeListener() {} };
const quiet = new console.Console({ stdout: sink as any, stderr: sink as any, colorMode: false });
quiet.log("%s and %o and %d%%", "text", { a: [1, 2, { b: 3 }] }, 42.5);
quiet.error(new Map([["key", new Set([1])]]), [undefined, null], -0);
quiet.table([{ a: 1, b: "x" }, { a: 2, c: true }]);
quiet.group("group");
quiet.dir({ deep: { deeper: { deepest: { hidden: 1 } } } }, { depth: 1 });
quiet.groupEnd();
quiet.assert(false, "it is %s", "false");
console.log(lines.join(""));
for (const options of [1, { stdout: 1 }, { stdout: sink, colorMode: "sometimes" }, { stdout: sink, groupIndentation: -1 }, { stdout: sink, inspectOptions: 1 }]) {
  try {
    new console.Console(options as any);
    console.log("taken");
  } catch (error) {
    console.log((error as any).code, (error as Error).message);
  }
}

(process as any)._rawDebug("%s goes to %s", "this", "stderr", { a: 1 });

const folder = mkdtempSync(join(tmpdir(), "env-file-"));
try {
  const file = join(folder, "some.env");
  writeFileSync(file, "# a comment\nFROM_THE_FILE=one\nQUOTED=\"two words\"\nexport EXPORTED='three'\nMULTI=\"a\nb\"\nPATH=not taken\nEMPTY=\n");
  process.loadEnvFile(file);
  console.log([process.env.FROM_THE_FILE, process.env.QUOTED, process.env.EXPORTED, process.env.MULTI, process.env.PATH === "not taken", process.env.EMPTY]);
  for (const path of [1, {}, join(folder, "missing.env")]) {
    try {
      process.loadEnvFile(path as any);
    } catch (error) {
      console.log((error as any).code, (error as any).syscall);
    }
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
