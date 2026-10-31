const fs = require("node:fs"), path = require("node:path");
const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "fs-"));
let sum = 0;
const small = "x".repeat(200), large = Buffer.alloc(1 << 20, 7);
for (let d = 0; d < 20; d++) {
  const dir = path.join(root, "d" + d, "e", "f");
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dir, "file" + i + ".txt"), small + i);
}
for (let round = 0; round < 5; round++)
  for (let d = 0; d < 20; d++) {
    const dir = path.join(root, "d" + d, "e", "f");
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      sum += fs.statSync(p).size + fs.readFileSync(p, "utf8").length + (fs.existsSync(p + ".no") ? 1 : 0);
    }
    sum += fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).length;
  }
for (let i = 0; i < 40; i++) { fs.writeFileSync(path.join(root, "large"), large); sum += fs.readFileSync(path.join(root, "large")).length; }
const fd = fs.openSync(path.join(root, "large"), "r"), chunk = Buffer.alloc(4096);
for (let i = 0; i < 5000; i++) sum += fs.readSync(fd, chunk, 0, 4096, (i % 256) * 4096);
fs.closeSync(fd);
for (let i = 0; i < 500; i++) fs.appendFileSync(path.join(root, "log"), "line " + i + "\n");
for (let i = 0; i < 125; i++) { fs.copyFileSync(path.join(root, "log"), path.join(root, "copy")); fs.renameSync(path.join(root, "copy"), path.join(root, "moved")); fs.unlinkSync(path.join(root, "moved")); }
sum += fs.readdirSync(root, { recursive: true }).length;
(async () => {
  for (let i = 0; i < 375; i++) sum += (await fs.promises.readFile(path.join(root, "d1", "e", "f", "file" + (i % 100) + ".txt"))).length;
  for (let i = 0; i < 375; i++) sum += (await Bun.file(path.join(root, "d2", "e", "f", "file" + (i % 100) + ".txt")).text()).length;
  for (let i = 0; i < 125; i++) sum += await Bun.write(path.join(root, "bun-write"), small);
  for (let i = 0; i < 125; i++) sum += (await fs.promises.stat(path.join(root, "log"))).size;
  fs.rmSync(root, { recursive: true, force: true });
  console.log("fs", sum);
})();
