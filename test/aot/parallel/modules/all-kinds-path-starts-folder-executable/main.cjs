// After `process.chdir()` into a folder that only the executable holds, calls what takes a path with a string, a Buffer, a Uint8Array and a URL, relative and absolute, in the synchronous,
// callback and promise forms, and prints each answer: the value, or the code, the path and the message of the error. All as under `bun run`. The folder `data` is embedded with --asset.
// Flags: --asset ./data
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const url = require("node:url");
const root = __dirname;
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "paths-")));
const clean = text =>
  String(text)
    .replace(/\d+(,\d+)+/g, bytes => Buffer.from(bytes.split(",").map(Number)).toString())
    .replaceAll(url.pathToFileURL(root).href, "file://<root>")
    .replaceAll(root, "<root>")
    .replaceAll(scratch, "<scratch>")
    .replaceAll("\\", "/");
const describe = value => {
  if (value === undefined || value === null || typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(clean(value.trim()));
  if (value instanceof fs.Stats) return `size ${value.isDirectory() ? "-" : value.size} file ${value.isFile()} folder ${value.isDirectory()}`;
  if (ArrayBuffer.isView(value)) return "bytes " + JSON.stringify(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString().trim());
  if (Array.isArray(value)) return "[" + value.map(entry => (entry instanceof fs.Dirent ? clean(path.join(entry.parentPath, entry.name)) + (entry.isDirectory() ? "/" : "") : clean(entry))).sort().join() + "]";
  return typeof value.bsize === "number" ? "a file system" : Object.prototype.toString.call(value);
};
const failure = error => `${error.code} ${error.syscall} path ${clean(error.path)} | ${clean(error.message)}`;
let made = 0;
const out = () => path.join(scratch, "made-" + made++);
const drain = directory => {
  const names = [];
  for (let entry; (entry = directory.readSync()); ) names.push(entry.name);
  directory.closeSync();
  return names.sort().join();
};
const readOpened = descriptor => {
  const bytes = Buffer.alloc(32);
  const size = fs.fstatSync(descriptor).size;
  const count = fs.readSync(descriptor, bytes, 0, 32, 0);
  fs.closeSync(descriptor);
  return size + ":" + bytes.toString("utf8", 0, count).trim();
};
const simple = (name, ...rest) => ({
  sync: given => fs[name + "Sync"](given, ...rest),
  callback: (given, done) => fs[name](given, ...rest, done),
  promise: given => fs.promises[name](given, ...rest),
});
const linked = error => {
  if (error && error.code !== "EXDEV") throw error;
  return "linked, or the two are on different file systems";
};
const operations = {
  access: simple("access", fs.constants.R_OK),
  exists: { sync: given => fs.existsSync(given), callback: (given, done) => fs.exists(given, found => done(null, found)) },
  stat: simple("stat"),
  lstat: simple("lstat"),
  statfs: simple("statfs"),
  readFile: simple("readFile", "utf8"),
  readdir: simple("readdir"),
  "readdir withFileTypes": simple("readdir", { withFileTypes: true }),
  realpath: simple("realpath"),
  readlink: simple("readlink"),
  opendir: {
    sync: given => drain(fs.opendirSync(given)),
    callback: (given, done) => fs.opendir(given, (error, directory) => (error ? done(error) : done(null, drain(directory)))),
    promise: async given => drain(await fs.promises.opendir(given)),
  },
  open: {
    files: true,
    sync: given => readOpened(fs.openSync(given, "r")),
    callback: (given, done) => fs.open(given, "r", (error, descriptor) => (error ? done(error) : done(null, readOpened(descriptor)))),
    promise: async given => {
      const handle = await fs.promises.open(given, "r");
      const text = await handle.readFile("utf8");
      await handle.close();
      return text;
    },
  },
  copyFile: {
    files: true,
    sync: given => {
      const to = out();
      fs.copyFileSync(given, to);
      return fs.readFileSync(to, "utf8");
    },
    callback: (given, done) => {
      const to = out();
      fs.copyFile(given, to, error => (error ? done(error) : done(null, fs.readFileSync(to, "utf8"))));
    },
    promise: async given => {
      const to = out();
      await fs.promises.copyFile(given, to);
      return fs.readFileSync(to, "utf8");
    },
  },
  link: {
    files: true,
    sync: given => {
      try {
        fs.linkSync(given, out());
      } catch (error) {
        return linked(error);
      }
      return linked();
    },
    callback: (given, done) =>
      fs.link(given, out(), error => {
        try {
          done(null, linked(error));
        } catch (thrown) {
          done(thrown);
        }
      }),
    promise: given => fs.promises.link(given, out()).then(linked, linked),
  },
  createReadStream: {
    files: true,
    promise: given =>
      new Promise((resolve, reject) => {
        let text = "";
        fs.createReadStream(given, "utf8")
          .on("data", chunk => (text += chunk))
          .on("end", () => resolve(text))
          .on("error", reject);
      }),
  },
  "Bun.file text": { files: true, promise: given => Bun.file(given).text() },
  "Bun.file exists": { promise: given => Bun.file(given).exists() },
  "Bun.file name": { missing: true, sync: given => Bun.file(given).name },
  "Bun.mmap": { files: true, sync: given => (process.platform === "win32" ? "no mapping here" : Bun.mmap(given)) },
};
const targets = {
  "a file": path.join(root, "data", "note.txt"),
  "a folder": path.join(root, "data"),
  "nothing": path.join(root, "data", "none.txt"),
  "below a file": path.join(root, "data", "note.txt", "below"),
};
(async () => {
  for (const directory of [root, path.join(root, "data", "sub")]) {
    process.chdir(directory);
    for (const [target, absolute] of Object.entries(targets)) {
      const relative = path.relative(process.cwd(), absolute);
      const spellings = [absolute, Buffer.from(absolute), new TextEncoder().encode(absolute), url.pathToFileURL(absolute), relative, Buffer.from(relative), new TextEncoder().encode(relative)];
      for (const [operation, { files, missing, ...forms }] of Object.entries(operations)) {
        if ((files && target === "a folder") || (missing && target === "a file")) continue;
        for (const [form, call] of Object.entries(forms)) {
          const answers = new Set();
          for (const given of spellings) {
            try {
              if (form === "callback") answers.add(await new Promise(resolve => call(given, (error, value) => resolve(error ? failure(error) : describe(value)))));
              else answers.add(describe(await call(given)));
            } catch (error) {
              answers.add(failure(error));
            }
          }
          console.log(`${operation}, ${form}, ${target}, from ${clean(directory)}: ${[...answers].join(" || ")}`);
        }
      }
    }
  }
  process.chdir(os.tmpdir());
  fs.rmSync(scratch, { recursive: true, force: true });
})();
