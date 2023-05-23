import fs from "fs";
import path from "path";

const OUT_DIR = path.join(import.meta.dir, "out/modules");
const TMP_DIR = path.join(import.meta.dir, "out/tmp");

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

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

const build = await Bun.build({
  entrypoints: entrypoints,
  target: "bun",
  sourcemap: process.env.NODE_ENV === "production" ? "none" : "external",
  minify: process.env.NODE_ENV === "production",
  naming: {
    entry: "[dir]/[name].[ext]",
  },
  root: import.meta.dir,
  define: {
    "process.platform": JSON.stringify(process.platform),
    "process.arch": JSON.stringify(process.arch),
  },
});

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

let totalSize = 0;

for (const output of build.outputs) {
  fs.mkdirSync(path.join(OUT_DIR, path.dirname(output.path)), { recursive: true });
  const transformedOutput = (await output.text()).replace(/^\/\/\s*@bun\s*\n/, "");
  totalSize += transformedOutput.length;
  Bun.write(path.join(OUT_DIR, output.path), transformedOutput);
}

console.log(`Build successful, total size: ${totalSize} bytes across ${build.outputs.length} files`);
