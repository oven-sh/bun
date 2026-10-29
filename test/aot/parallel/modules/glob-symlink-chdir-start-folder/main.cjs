// After `process.chdir(__dirname)`, a folder that only the executable holds: Bun.Glob and fs.glob scan from there, the target of a symlink is stored as written, and a relative path leads out
// to the disk again, all as under `bun run`. The folder `data` is embedded with --asset.
// Flags: --asset ./data
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const show = (what, action) => {
  try {
    console.log(what + ":", action());
  } catch (error) {
    console.log(what + ": threw", error.code, error.syscall);
  }
};
const list = paths =>
  [...paths]
    .map(found => found.replaceAll("\\", "/"))
    .sort()
    .join();
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "start-at-a-folder-")));
fs.writeFileSync(path.join(scratch, "on-disk.txt"), "on disk");
process.chdir(scratch);
process.chdir(__dirname);

show("Glob", () => list(new Bun.Glob("data/*.txt").scanSync()));
show("Glob in every folder", () => list(new Bun.Glob("data/**/*.txt").scanSync()));
show("Glob finds nothing of the folder it left", () => list(new Bun.Glob("on-disk.txt").scanSync()));
show("Glob with cwd .", () => list(new Bun.Glob("data/*.txt").scanSync({ cwd: "." })));
show("Glob with a relative cwd", () => list(new Bun.Glob("*.txt").scanSync({ cwd: "data" })));
show("Glob with a relative cwd as a string", () => list(new Bun.Glob("*.txt").scanSync("data/sub")));
show("Glob with an empty cwd", () => list(new Bun.Glob("data/*.txt").scanSync({ cwd: "" })));
show("Glob with whole paths", () =>
  list(
    [...new Bun.Glob("*.txt").scanSync({ cwd: "data", absolute: true })].map(found => path.relative(__dirname, found)),
  ),
);
show("Glob with a relative cwd that leads out", () =>
  list(new Bun.Glob("*.txt").scanSync({ cwd: path.relative(__dirname, scratch) })),
);
show("Glob with a whole cwd on the disk", () => list(new Bun.Glob("*.txt").scanSync({ cwd: scratch })));
show("fs.globSync", () => list(fs.globSync("data/*.txt")));

show("a path in a Buffer", () => fs.readFileSync(Buffer.from("data/note.txt"), "utf8").trim());
show("a path in a Uint8Array", () => fs.statSync(new TextEncoder().encode("data/note.txt")).size);
show("Bun.pathToFileURL", () => path.relative(__dirname, Bun.fileURLToPath(Bun.pathToFileURL("data"))));

show("symlinkSync", () => fs.symlinkSync("on-disk.txt", path.join(scratch, "link")));
show("readlinkSync", () => fs.readlinkSync(path.join(scratch, "link")));
show("readFileSync through the link", () => fs.readFileSync(path.join(scratch, "link"), "utf8"));

(async () => {
  console.log("Glob.scan:", list(await Array.fromAsync(new Bun.Glob("data/*.txt").scan())));
  await fs.promises
    .symlink("on-disk.txt", path.join(scratch, "second-link"))
    .catch(error => console.log("promises.symlink: rejected", error.code));
  show("readlinkSync of the second", () => fs.readlinkSync(path.join(scratch, "second-link")));
  show("symlinkSync with the target in a Buffer", () =>
    fs.symlinkSync(Buffer.from("on-disk.txt"), path.join(scratch, "third-link")),
  );
  show("readlinkSync of the third", () => fs.readlinkSync(path.join(scratch, "third-link")));
  console.log(
    "promises.readFile of a path in a Buffer:",
    (await fs.promises.readFile(Buffer.from("data/note.txt"), "utf8")).trim(),
  );

  show(
    "chdir out by a relative path",
    () => (process.chdir(path.relative(__dirname, scratch)), process.cwd() === scratch),
  );
  show("readFileSync there", () => fs.readFileSync("on-disk.txt", "utf8"));
  show("Glob there", () => list(new Bun.Glob("*.txt").scanSync()));
  show(
    "chdir in again",
    () => (process.chdir(path.join(__dirname, "data")), process.cwd() === path.join(__dirname, "data")),
  );
  show("chdir out by a relative path to what is not there", () =>
    process.chdir(path.join(path.relative(process.cwd(), scratch), "none")),
  );
  show("cwd is as it was", () => process.cwd() === path.join(__dirname, "data"));
  show(
    "chdir out from a folder further in",
    () => (process.chdir(path.relative(process.cwd(), scratch)), process.cwd() === scratch),
  );
  process.chdir(os.tmpdir());
  fs.rmSync(scratch, { recursive: true, force: true });
})();
