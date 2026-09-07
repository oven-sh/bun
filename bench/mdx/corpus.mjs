import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const manifestPath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const entries = JSON.parse(readFileSync(manifestPath, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const worker = process.env.MDX_CORPUS_WORKER;
if (!worker) {
  mkdirSync(output, { recursive: true });
  const engines = { native: process.execPath, reference: process.execPath };
  if (process.env.MDX_CORPUS_BASELINE) engines.baseline = process.env.MDX_CORPUS_BASELINE;
  for (const [engine, executable] of Object.entries(engines)) {
    const child = spawnSync(executable, [import.meta.filename, manifestPath, output], {
      env: { ...process.env, MDX_CORPUS_WORKER: engine },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (child.status !== 0) throw new Error(`${engine} corpus worker failed (${child.status}): ${child.stderr}`);
    console.log(child.stdout.trim());
  }
} else {
  const sources = entries.map(entry => readFileSync(resolve(dirname(manifestPath), entry.path), "utf8"));
  const transpiler = new Bun.Transpiler({ loader: "tsx", target: "browser" });
  let processors;
  if (worker === "reference") {
    const deps = createRequire(join(resolve(process.env.MDX_BENCH_DEPS || import.meta.dirname), "package.json"));
    const [mdx, gfm, frontmatter, mdxFrontmatter] = await Promise.all(
      ["@mdx-js/mdx", "remark-gfm", "remark-frontmatter", "remark-mdx-frontmatter"].map(
        name => import(pathToFileURL(deps.resolve(name)).href),
      ),
    );
    processors = [false, true].map(hasFrontmatter =>
      mdx.createProcessor({
        jsx: true,
        development: false,
        tableCellAlignToStyle: false,
        remarkPlugins: [
          gfm.default,
          ...(hasFrontmatter ? [frontmatter.default, [mdxFrontmatter.default, { name: "frontmatter" }]] : []),
        ],
      }),
    );
  }
  const compile = source =>
    processors
      ? String(processors[Number(/^---\r?\n/.test(source))].processSync(source))
      : Bun.mdx.compile(source, { permissiveAutolinks: true });
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const source = sources[i];
    const result = { id: entries[i].id, bytes: Buffer.byteLength(source), sha256: hash(source) };
    try {
      const jsx = compile(source);
      result.compiled = true;
      result.outputSha256 = hash(jsx);
      try {
        transpiler.transformSync(jsx);
        result.validJavaScript = true;
      } catch (error) {
        result.validJavaScript = false;
        result.validationError = error.name;
      }
    } catch (error) {
      result.compiled = false;
      result.error = error.name;
      if (typeof error.ruleId === "string") result.ruleId = error.ruleId;
    }
    results.push(result);
    if ((i + 1) % 100 === 0) writeFileSync(join(output, `${worker}.json`), JSON.stringify(results, null, 2) + "\n");
  }
  writeFileSync(join(output, `${worker}.json`), JSON.stringify(results, null, 2) + "\n");
  console.log(
    JSON.stringify({
      engine: worker,
      documents: results.length,
      compiled: results.filter(r => r.compiled).length,
      validJavaScript: results.filter(r => r.validJavaScript).length,
      revision: Bun.revision,
    }),
  );
}
