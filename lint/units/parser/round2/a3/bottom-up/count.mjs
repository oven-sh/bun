import { Glob } from "bun";
import { statSync } from "node:fs";
const root = process.argv[2];
const t0 = performance.now();
const all = [];
for (const dir of ["test", "src/js"]) {
  for (const file of new Glob("**/*.{ts,tsx,mts,cts}").scanSync({ cwd: root + "/" + dir, dot: false, followSymlinks: false, onlyFiles: true })) {
    all.push(dir + "/" + file);
  }
}
const nm = all.filter(f => f.includes("/node_modules/"));
const files = all.filter(f => !f.includes("/node_modules/")).sort();
let bytes = 0;
for (const f of files) bytes += statSync(root + "/" + f).size;
const count = re => files.filter(f => re.test(f)).length;
console.log(JSON.stringify({ all: all.length, inNodeModules: nm.length, files: files.length, bytes, ts: count(/(?<!\.d)\.ts$/), tsx: count(/\.tsx$/), dts: count(/\.d\.ts$/), mts: count(/\.mts$/), cts: count(/\.cts$/), dmts: count(/\.d\.[mc]ts$/), test: count(/^test\//), srcjs: count(/^src\/js\//), ms: Math.round(performance.now() - t0) }));
await Bun.write("/tmp/a3-seam/glob-files.txt", files.join("\n") + "\n");
