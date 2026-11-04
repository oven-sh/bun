// A program lists a folder beside it and loads each file that it finds there. An executable holds those files as compiled code.
// Under: --aot-allow-code-from-disk: behind the disk such an executable asks the same tables
const fs = require("node:fs");
const path = require("node:path");

const sorted = list => [...list].sort().join(" ");
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.code;
  }
};

for (const file of fs.readdirSync(__dirname + "/commands").sort()) {
  if (!file.endsWith(".js")) continue;
  const command = require("./commands/" + file);
  console.log(file, command.name, command.run());
}
console.log(require(`./commands/deeper/${process.argv[2] ?? "gamma"}.js`).run());

const folder = __dirname + "/commands";
console.log("names:", sorted(fs.readdirSync(folder)));
console.log("a slash at the end:", sorted(fs.readdirSync(folder + "/")));
console.log("deeper:", sorted(fs.readdirSync(path.join(folder, "deeper"))));
console.log("all below:", sorted(fs.readdirSync(folder, { recursive: true })));
const kinds = fs.readdirSync(folder, { withFileTypes: true });
console.log("kinds:", sorted(kinds.map(entry => entry.name + (entry.isDirectory() ? "/" : entry.isFile() ? "" : "?"))));
console.log(
  "of a file:",
  attempt(() => fs.readdirSync(folder + "/alpha.js")),
);
console.log(
  "of nothing:",
  attempt(() => fs.readdirSync(folder + "/absent")),
);

const file = path.join(folder, "beta.js");
console.log(
  "exists:",
  fs.existsSync(file),
  fs.existsSync(folder),
  fs.existsSync(folder + "/absent.js"),
  fs.existsSync(folder + "/bet"),
);
console.log("stat:", fs.statSync(file).isFile(), fs.statSync(file).isDirectory(), fs.statSync(folder).isDirectory());
console.log("lstat:", fs.lstatSync(file).isFile(), fs.lstatSync(folder).isDirectory());
console.log(
  "stat of nothing:",
  attempt(() => fs.statSync(folder + "/absent.js")),
);
console.log("nothing, quietly:", fs.statSync(folder + "/absent.js", { throwIfNoEntry: false }));
console.log(
  "access:",
  attempt(() => fs.accessSync(file)),
  attempt(() => fs.accessSync(folder)),
  attempt(() => fs.accessSync(folder + "/absent.js")),
);

// The disk has no such name, and no compiled file lies below it.
const notText = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const odd = notText(folder + "/caf", [0xe9]);
const code = action => attempt(() => (action(), "found"));
console.log(
  "a name that is not UTF-8:",
  fs.existsSync(odd),
  fs.existsSync(new Uint8Array(odd)),
  fs.existsSync(notText(odd, "/alpha.js")),
  fs.existsSync(notText([0xe9])),
  typeof fs.statSync(odd, { throwIfNoEntry: false }),
  code(() => fs.statSync(odd)),
  code(() => fs.lstatSync(odd)),
  code(() => fs.accessSync(odd)),
  code(() => fs.realpathSync(odd)),
  code(() => fs.realpathSync.native(odd)),
  code(() => fs.readdirSync(odd)),
  code(() => fs.opendirSync(odd).closeSync()),
  code(() => fs.readFileSync(odd)),
  code(() => fs.rmSync(odd)),
);

(async () => {
  const promised = promise =>
    promise.then(
      () => "found",
      error => error.code,
    );
  console.log(
    "promised, a name that is not UTF-8:",
    await promised(fs.promises.stat(odd)),
    await promised(fs.promises.lstat(odd)),
    await promised(fs.promises.access(odd)),
    await promised(fs.promises.realpath(odd)),
    await promised(Bun.file(odd).stat()),
    await Bun.file(odd).exists(),
  );
  console.log("promised names:", sorted(await fs.promises.readdir(folder)));
  console.log(
    "promised stat:",
    (await fs.promises.stat(file)).isFile(),
    (await fs.promises.stat(folder)).isDirectory(),
  );
  console.log(
    "promised access:",
    await fs.promises.access(file).then(
      () => "yes",
      error => error.code,
    ),
  );
  console.log("promised nothing:", await fs.promises.readdir(folder + "/absent").catch(error => error.code));
  fs.readdir(folder, (error, names) => console.log("called back:", error, sorted(names)));
})();
