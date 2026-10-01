// A check that reports nothing and records what the default check would pass as operands. Scratch file.
import { appendFileSync } from "node:fs";
const out = process.env.RECORD_OUT ?? "/tmp/conf-wb/operands.jsonl";
let buffer: string[] = [];
export default async function check(input: any) {
  buffer.push(
    JSON.stringify({
      name: input.instance.name,
      kind: input.instance.oracle?.class,
      cwd: input.currentDirectory,
      rootFiles: input.rootFiles,
      otherFiles: input.otherFiles,
      units: input.units.map((u: any) => [u.unitName, u.content.length]),
      symlinks: input.symlinks.length,
    }),
  );
  if (buffer.length >= 500) flush();
  return { diagnostics: [] };
}
function flush() {
  if (buffer.length > 0) appendFileSync(out, buffer.join("\n") + "\n");
  buffer = [];
}
process.on("exit", flush);
