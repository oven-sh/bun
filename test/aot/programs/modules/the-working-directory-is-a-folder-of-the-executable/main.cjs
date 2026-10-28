// `process.chdir(__dirname)`, as many servers begin. In an executable that folder is in the executable alone. The call succeeds, and process.cwd(), path.resolve() and every relative path
// given to node:fs, Bun.file() and require.resolve() start there, as under `bun run`. The folder `data` is embedded with --asset.
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const started = process.cwd();
const show = (what, action) => {
  try {
    console.log(what + ":", action());
  } catch (error) {
    console.log(what + ": threw", error.code, error.syscall);
  }
};
show("chdir", () => (process.chdir(__dirname), "done"));
show("cwd", () => process.cwd() === __dirname);
show("path.resolve", () => path.resolve("data", "note.txt") === path.join(__dirname, "data", "note.txt"));
show("path.relative", () => path.relative(".", path.join(__dirname, "data")));
show("readFileSync", () => fs.readFileSync("data/note.txt", "utf8").trim());
show("readFileSync with dots", () => fs.readFileSync("./data/sub/../note.txt", "utf8").trim());
show("existsSync", () => [fs.existsSync("data/note.txt"), fs.existsSync("data/none.txt")].join());
show("statSync", () => [fs.statSync("data/note.txt").size, fs.statSync("data").isDirectory()].join());
show("readdirSync", () => fs.readdirSync("data").sort().join());
show("realpathSync", () => fs.realpathSync("data/note.txt") === path.join(__dirname, "data", "note.txt"));
show("accessSync", () => fs.accessSync("data/note.txt", fs.constants.R_OK));
show("openSync and readSync", () => {
  const descriptor = fs.openSync("data/note.txt", "r");
  const bytes = Buffer.alloc(4);
  const count = fs.readSync(descriptor, bytes);
  fs.closeSync(descriptor);
  return bytes.toString("utf8", 0, count);
});
show("require.resolve with paths", () => require.resolve("./data/module.cjs", { paths: [process.cwd()] }) === path.join(__dirname, "data", "module.cjs"));
show("chdir further in", () => (process.chdir("data"), process.cwd() === path.join(__dirname, "data")));
show("readFileSync there", () => fs.readFileSync("note.txt", "utf8").trim());
show("chdir to a folder above", () => (process.chdir(".."), process.cwd() === __dirname));
show("chdir to what is not there", () => process.chdir("none"));
show("chdir to a file", () => process.chdir("data/note.txt"));
show("cwd is as it was", () => process.cwd() === __dirname);
(async () => {
  console.log("promises.readFile:", (await fs.promises.readFile("data/note.txt", "utf8")).trim());
  console.log("Bun.file:", (await Bun.file("data/note.txt").text()).trim(), Bun.file("data/note.txt").size);
  console.log("createReadStream:", await new Promise((resolve, reject) => {
    let text = "";
    fs.createReadStream("data/note.txt", "utf8").on("data", chunk => (text += chunk)).on("end", () => resolve(text.trim())).on("error", reject);
  }));
  console.log("a Worker:", await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker.cjs"));
    worker.on("message", resolve).on("error", reject);
  }));
  show("chdir out", () => (process.chdir(started), process.cwd() === started));
  show("path.resolve outside", () => path.resolve("x") === path.join(started, "x"));
  show("and in again by the whole path", () => (process.chdir(path.join(__dirname, "data", "sub")), fs.readFileSync("../note.txt", "utf8").trim()));
})();
