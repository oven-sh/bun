import { BuildConfig } from "bun";
import fs from "fs";
import path from "path";

const OUT_DIR = path.join(import.meta.dir, "out/");
const TMP_DIR = path.join(import.meta.dir, "out/tmp");

// Because we do not load sourcemaps, we are not enabling identifiers + whitespace
// minification on all files, just on the ones without logic or were already bundled
const minifyList = [
  "node/stream.js",
  "node/crypto.js",

  "node/assert.js",
  "node/assert.strict.js",
  "node/fs.promises.ts",
  "node/path.js",
  "node/path.posix.js",
  "node/path.win32.js",
  "node/stream.promises.js",
  "node/stream.consumers.js",
  "node/stream.web.js",
];

if (fs.existsSync(OUT_DIR + "/modules")) {
  fs.rmSync(OUT_DIR + "/modules", { recursive: true });
}
if (fs.existsSync(OUT_DIR + "/modules_dev")) {
  fs.rmSync(OUT_DIR + "/modules_dev", { recursive: true });
}

function readdirRecursive(root: string): string[] {
  const files = fs.readdirSync(root, { withFileTypes: true });
  return files.flatMap(file => {
    const fullPath = path.join(root, file.name);
    return file.isDirectory() ? readdirRecursive(fullPath) : fullPath;
  });
}

const entrypoints = ["./bun", "./node", "./thirdparty"]
  .flatMap(dir => readdirRecursive(path.join(import.meta.dir, dir)))
  .filter(file => file.endsWith(".js") || (file.endsWith(".ts") && !file.endsWith(".d.ts")));

const opts = {
  target: "bun",
  naming: {
    entry: "[dir]/[name].[ext]",
  },
  root: import.meta.dir,
  define: {
    "process.platform": JSON.stringify(process.platform),
    "process.arch": JSON.stringify(process.arch),
  },
} as const;

const build_prod_minified = await Bun.build({
  entrypoints: entrypoints.filter(file => minifyList.includes(file.slice(import.meta.dir.length + 1))),
  minify: true,
  ...opts,
});

const build_prod_unminified = await Bun.build({
  entrypoints: entrypoints.filter(file => !minifyList.includes(file.slice(import.meta.dir.length + 1))),
  minify: { syntax: true },
  ...opts,
});

const build_dev = await Bun.build({
  entrypoints: entrypoints,
  minify: { syntax: true },
  sourcemap: "external",
  ...opts,
});

for (const [build, outdir] of [
  [build_dev, path.join(OUT_DIR, "modules_dev")],
  [build_prod_minified, path.join(OUT_DIR, "modules")],
  [build_prod_unminified, path.join(OUT_DIR, "modules")],
] as const) {
  if (!build.success) {
    console.error("Build failed");
    throw new AggregateError(build.logs);
  }

  if (build.logs.length) {
    console.log("Build has warnings:");
    for (const log of build.logs) {
      console.log(log);
    }
  }

  for (const output of build.outputs) {
    fs.mkdirSync(path.join(outdir, path.dirname(output.path)), { recursive: true });

    if (output.kind === "entry-point" || output.kind === "chunk") {
      const transformedOutput = (await output.text()).replace(/^(\/\/.*?\n)+/g, "");

      if (transformedOutput.includes("$bundleError")) {
        // attempt to find the string that was passed to $bundleError
        const match = transformedOutput.match(/(?<=\$bundleError\(")(?:[^"\\]|\\.)*?(?="\))/);
        console.error(`Build ${output.path} $bundleError: ${match?.[0] ?? "unknown"}`);
        console.error(`DCE should have removed this function call, but it was not.`);
        process.exit(1);
      }

      console.log(`Writing ${output.path}`);
      Bun.write(path.join(outdir, output.path), transformedOutput);
    } else {
      Bun.write(path.join(outdir, output.path), output);
    }
  }
}

console.log(`Took ${performance.now().toFixed(2)}ms`);
