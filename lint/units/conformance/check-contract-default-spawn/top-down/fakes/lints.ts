// A command that stands for a linter: it reads its operands and never runs them.
// A line of an operand that starts with "//~ " tells it what to do; "{file}" is the operand as it was given.
//   //~ print <line for stderr>    //~ stdout <line>    //~ exit <code>    //~ kill <signal>    //~ hang
// An operand that has no such line is parsed, and each syntax error is printed with the code TS1005.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "--lint" || args.length < 2) {
  process.stderr.write("usage: --lint <files>\n");
  process.exit(1);
}
if (process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT !== "1") {
  process.stderr.write("error: --lint needs BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1\n");
  process.exit(1);
}
if (process.env.BUN_INTERNAL_LINT_CONFORMANCE === "1") {
  await manifest(args[1]);
  process.exit(0);
}
let err = "";
let out = "";
let exit: number | undefined;
let errors = 0;
for (const operand of args.slice(1)) {
  let text: string;
  try {
    text = readFileSync(operand, "utf8");
  } catch {
    process.stderr.write(`error: cannot read ${operand}\n`);
    process.exit(1);
  }
  const orders = text.split(/\r?\n/).filter(l => l.startsWith("//~ "));
  for (const order of orders) {
    const [, verb, rest = ""] = /^\/\/~ (\S+) ?(.*)$/.exec(order)!;
    const value = rest.replaceAll("{file}", operand);
    if (verb === "print") {
      err += value + "\n";
      if (/^(?:\S.*?\(\d+,\d+\): )?error /.test(value)) errors++;
    } else if (verb === "stdout") out += value + "\n";
    else if (verb === "exit") exit = Number(value);
    else if (verb === "kill") {
      process.stderr.write(err);
      process.kill(process.pid, value);
      await new Promise(() => setInterval(() => {}, 1 << 30));
    } else if (verb === "hang") await new Promise(() => setInterval(() => {}, 1 << 30));
  }
  if (orders.length > 0) continue;
  const loader = ({ ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".jsx": "jsx" } as Record<string, "ts" | "tsx" | "jsx">)[extname(operand)] ?? "js";
  try {
    new Bun.Transpiler({ loader }).transformSync(text);
  } catch (e: any) {
    for (const x of e.errors ?? [e]) {
      err += `${operand}(${x.position?.line ?? 1},${x.position?.column ?? 1}): error TS1005: ${x.message}\n`;
      errors++;
    }
  }
}
process.stdout.write(out);
process.stderr.write(err);
process.exit(exit ?? (errors > 0 ? 2 : 0));

// The batch form: the operand is a manifest, and each instance gives one line of JSON on stdout.
//   //~ diag <diagnostic as JSON>    //~ standin <name>    //~ refuse <text>    //~ raw <line for stdout>
async function manifest(path: string): Promise<void> {
  let kept = "";
  const m = JSON.parse(readFileSync(path, "utf8"));
  if (m.version !== 1) {
    process.stderr.write("error: unknown version of the manifest\n");
    process.exit(1);
  }
  for (const instance of m.instances) {
    const diagnostics: unknown[] = [];
    const standIns: string[] = [];
    let line: string | undefined;
    for (const root of instance.rootNames as string[]) {
      const text = readFileSync(root, "utf8");
      const orders = text.split(/\r?\n/).filter(l => l.startsWith("//~ "));
      for (const order of orders) {
        const [, verb, rest = ""] = /^\/\/~ (\S+) ?(.*)$/.exec(order)!;
        const value = rest.replaceAll("{file}", root);
        if (verb === "diag") diagnostics.push(JSON.parse(value));
        else if (verb === "standin") standIns.push(value);
        else if (verb === "refuse") line = JSON.stringify({ id: instance.id, refused: value });
        else if (verb === "raw") line = value;
        else if (verb === "exit") process.exit(Number(value));
        else if (verb === "kill") {
          process.kill(process.pid, value);
          await new Promise(() => setInterval(() => {}, 1 << 30));
        } else if (verb === "hang") await new Promise(() => setInterval(() => {}, 1 << 30));
      }
      if (orders.length > 0) continue;
      const loader = ({ ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".jsx": "jsx" } as Record<string, "ts" | "tsx" | "jsx">)[extname(root)] ?? "js";
      try {
        new Bun.Transpiler({ loader }).transformSync(text);
      } catch (e: any) {
        for (const x of e.errors ?? [e]) {
          diagnostics.push({
            category: "error",
            code: 1005,
            messageText: x.message,
            location: { file: root, start: x.position?.offset ?? 0, length: x.position?.length ?? 0, line: x.position?.line ?? 1, character: x.position?.column ?? 1 },
            relatedInformation: [],
          });
        }
      }
    }
    line ??= JSON.stringify({ id: instance.id, diagnostics, standIns });
    if (process.env.FAKE_LINT_KEEPS_LINES === "1") kept += line + "\n";
    else await Bun.write(Bun.stdout, line + "\n");
  }
  await Bun.write(Bun.stdout, kept);
}
