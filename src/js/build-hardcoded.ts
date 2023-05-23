import fs from "fs";
import path from "path";

const OUT_DIR = path.join(import.meta.dir, "out/");
const TMP_DIR = path.join(import.meta.dir, "out/tmp");

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

const build_prod = await Bun.build({
  entrypoints: entrypoints,
  target: "bun",
  minify: true,
  naming: {
    entry: "[dir]/[name].[ext]",
  },
  root: import.meta.dir,
  define: {
    "process.platform": JSON.stringify(process.platform),
    "process.arch": JSON.stringify(process.arch),
  },
});

const build_dev = await Bun.build({
  entrypoints: entrypoints,
  target: "bun",
  sourcemap: "external",
  minify: {
    syntax: true,
  },
  naming: {
    entry: "[dir]/[name].[ext]",
  },
  root: import.meta.dir,
  define: {
    "process.platform": JSON.stringify(process.platform),
    "process.arch": JSON.stringify(process.arch),
  },
});

if (!build_prod.success) {
  console.error("Build failed");
  throw new AggregateError(build_prod.logs);
}

if (build_prod.logs.length) {
  console.log("Build has warnings:");
  for (const log of build_prod.logs) {
    console.log(log);
  }
}

let totalSize = 0;

for (const [build, outdir] of [
  [build_dev, path.join(OUT_DIR, "modules_dev")],
  [build_prod, path.join(OUT_DIR, "modules")],
] as const) {
  for (const output of build.outputs) {
    fs.mkdirSync(path.join(outdir, path.dirname(output.path)), { recursive: true });

    if (output.kind === "entry-point" || output.kind === "chunk") {
      const transformedOutput = (await output.text()).replace(/^\/\/\s*@bun\s*\n/, "");

      if (transformedOutput.includes("$bundleError")) {
        // attempt to find the string that was passed to $bundleError
        const match = transformedOutput.match(/(?<=\$bundleError\(")(?:[^"\\]|\\.)*?(?="\))/);
        console.error(`Build ${output.path} $bundleError: ${match?.[0] ?? "unknown"}`);
        console.error(`DCE should have removed this function call, but it was not.`);
        process.exit(1);
      }

      totalSize += transformedOutput.length;
      Bun.write(path.join(outdir, output.path), transformedOutput);
    } else {
      Bun.write(path.join(outdir, output.path), output);
    }
  }
}

console.log(`Build successful, total size: ${totalSize} bytes across ${build_prod.outputs.length} files`);
console.log(`Took ${performance.now().toFixed(2)}ms`);
