// Mixed module graphs (../generators/mixed-module-graphs.ts), each bundled into one file by `bun build --target=bun`
// first. The bundle wraps files in lazy `__commonJS(..)` and `__esm(..)` functions. The bundle built with --aot must
// print what it prints under `bun run`.
import { spawnSync } from "bun";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asProgram, type Drawn } from "../family";
import { program } from "../generators/mixed-module-graphs";
import { Random } from "../random";

const drawn: Drawn = (seed, runner) => {
  if (runner.name !== "product") return;
  const random = new Random(seed);
  const graph = program(seed, 7);
  if (graph.importsBesideTheRest) return;
  const format = random.pick(["esm", "esm", "cjs"]);
  const shape = [
    ...(random.chance(0.25) ? ["--minify"] : random.chance(0.2) ? ["--minify-syntax"] : []),
    ...(format === "esm" && random.chance(0.2) ? ["--splitting"] : []),
  ];
  const folder = mkdtempSync(join(tmpdir(), "module-graphs-bundled-first-"));
  try {
    mkdirSync(join(folder, "src"));
    for (const [name, text] of Object.entries({ ...graph.files, [graph.file]: graph.text }))
      writeFileSync(join(folder, "src", name), text);
    const bundling = spawnSync({
      cmd: [process.execPath, "build", "--target=bun", `--format=${format}`, ...shape, join("src", graph.file), "--outdir", "bundle"], // prettier-ignore
      cwd: folder,
      env: { ...process.env, NO_COLOR: "1" },
      stdout: "ignore",
      stderr: "ignore",
      timeout: 60_000,
    });
    if (bundling.exitCode !== 0) return;
    const file = graph.file.replace(/\.[a-z]+$/, ".js");
    const { [file]: text, ...chunks } = Object.fromEntries(
      readdirSync(join(folder, "bundle")).map(name => [name, readFileSync(join(folder, "bundle", name), "utf8")]),
    );
    // `import.meta` is invalid in the CommonJS format.
    if (text === undefined || (format === "cjs" && text.includes("import.meta"))) return;
    const made = asProgram({ file, text, files: chunks });
    return made && { seed, ...made, notes: `format ${format} ${shape.join(" ")}`, group: format, needsOwnBuild: true };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};
export default drawn;
