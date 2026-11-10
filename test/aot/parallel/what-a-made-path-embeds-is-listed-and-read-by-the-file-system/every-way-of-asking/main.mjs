import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dir, "parts");
const ask = async (word, work) => {
  try {
    console.log(word, await work());
  } catch (error) {
    console.log(word, error.code ?? error.name);
  }
};
const kinds = entries => entries.map(entry => entry.name + (entry.isDirectory() ? "/" : entry.isFile() ? "" : "?")).sort().join(" ");
const all = async directory => { const names = []; for await (const entry of directory) names.push(entry); return kinds(names); };
(async () => {
  await ask("readdirSync", () => fs.readdirSync(folder).sort().join(" "));
  await ask("withFileTypes", () => kinds(fs.readdirSync(folder, { withFileTypes: true })));
  await ask("recursive", () => fs.readdirSync(folder, { recursive: true }).sort().join(" "));
  await ask("sub", () => fs.readdirSync(path.join(folder, "sub")).sort().join(" "));
  await ask("existsSync", () => ["a.cjs", "b.json", "c.toml", "d.txt", "sub", "sub/e.json", "none.json", "b.json/x"].map(name => fs.existsSync(path.join(folder, name))).join(" "));
  await ask("statSync", () => ["b.json", "d.txt", "sub", "sub/e.json"].map(name => { const stat = fs.statSync(path.join(folder, name)); return stat.isFile() + "/" + stat.isDirectory(); }).join(" "));
  await ask("lstatSync", () => fs.lstatSync(path.join(folder, "b.json")).isFile());
  await ask("accessSync", () => fs.accessSync(path.join(folder, "c.toml")) ?? "fine");
  await ask("statSync of none", () => fs.statSync(path.join(folder, "none.json")).isFile());
  await ask("opendirSync", () => { const directory = fs.opendirSync(folder); const names = []; for (let entry; (entry = directory.readSync()); ) names.push(entry); directory.closeSync(); return kinds(names); });
  await ask("promises.readdir", async () => (await fs.promises.readdir(folder)).sort().join(" "));
  await ask("promises.readdir withFileTypes", async () => kinds(await fs.promises.readdir(folder, { withFileTypes: true })));
  await ask("promises.stat", async () => (await fs.promises.stat(path.join(folder, "b.json"))).isFile());
  await ask("promises.access", async () => (await fs.promises.access(path.join(folder, "d.txt"))) ?? "fine");
  await ask("promises.opendir", async () => all(await fs.promises.opendir(folder)));
  await ask("callback", () => new Promise((resolve, reject) => fs.readdir(folder, (error, names) => (error ? reject(error) : resolve(names.sort().join(" "))))));
  for (const name of fs.readdirSync(folder, { recursive: true }).sort()) {
    if (fs.statSync(path.join(folder, name)).isFile()) await ask("require " + name, () => { const it = require(path.join(folder, name)); return typeof it === "string" ? JSON.stringify(it) : JSON.stringify(it.is ?? it.default); });
  }
  process.exit(0);
})();
