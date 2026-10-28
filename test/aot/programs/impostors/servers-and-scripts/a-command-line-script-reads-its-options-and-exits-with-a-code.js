import { parseArgs } from "node:util";

function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        output: { type: "string", short: "o", default: "out.txt" },
        include: { type: "string", multiple: true },
        level: { type: "string" },
      },
    });
  } catch (error) {
    return { code: 2, message: error.code };
  }
  const { values, positionals } = parsed;
  if (values.help) return { code: 0, message: "usage: tool [-o file] [--include glob].. files.." };
  const level = values.level === undefined ? 1 : Number(values.level);
  if (!Number.isInteger(level) || level < 0 || level > 9) return { code: 2, message: "level must be 0 to 9, not " + values.level };
  if (positionals.length === 0) return { code: 1, message: "no files" };
  return { code: 0, message: positionals.map(name => name + " -> " + values.output + "@" + level).join(", ") + (values.include ? " including " + values.include.join("|") : "") };
}

for (const argv of [["-h"], [], ["a.txt"], ["a.txt", "b.txt", "-o", "x", "--level=3"], ["--include", "*.js", "--include=*.ts", "src"], ["--level", "ten", "a"], ["--level", "10", "a"], ["--nope"], ["-o"], ["--", "--help"], ["-ho", "y", "z"]])
  console.log(JSON.stringify(argv), run(argv));

console.log(process.argv.slice(2), Bun.argv.length === process.argv.length, typeof Bun.main, import.meta.main, typeof import.meta.dir, typeof import.meta.path);
process.stdout.write("no newline at the end, then exit 0");
process.stdout.write("\n");
setTimeout(() => console.log("WRONG: ran after exit"), 10);
process.exitCode = 3;
process.exit(0);
