// Stand-in for a command that lints: reads its operands, never runs them, prints tsc's plain format on stderr.
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "--lint" || process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT !== "1" || args.length < 2) {
  process.stderr.write("usage: --lint <file>... with BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1\n");
  process.exit(1);
}
let errors = 0;
let exit: number | undefined;
let out = "";
for (const operand of args.slice(1)) {
  const path = resolve(operand);
  const text = readFileSync(path, "utf8");
  const name = relative(process.cwd(), path).replaceAll("\\", "/");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*const\s+)([A-Za-z_$][\w$]*): number = "/.exec(line);
    if (m !== null) {
      out += `${name}(${i + 1},${m[1].length + 1}): error TS2322: Type 'string' is not assignable to type 'number'.\n`;
      errors++;
    }
    const d = /^\/\/! (stderr|stdout|exit|signal|spin): ?(.*)$/.exec(line);
    if (d === null) continue;
    if (d[1] === "stderr") {
      out += d[2].replaceAll("<name>", name).replaceAll("<path>", path) + "\n";
      if (/(^|\): )error /.test(d[2])) errors++;
    } else if (d[1] === "stdout") process.stdout.write(d[2] + "\n");
    else if (d[1] === "exit") exit = Number(d[2]);
    else if (d[1] === "signal") {
      process.stderr.write(out);
      process.kill(process.pid, d[2]);
      await new Promise(() => {});
    } else if (d[1] === "spin") for (;;) {}
  }
}
process.stderr.write(out);
process.exit(exit ?? (errors > 0 ? 2 : 0));
