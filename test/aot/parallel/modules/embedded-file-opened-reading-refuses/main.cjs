// A descriptor that fs.open() gives for reading an embedded file reads it and refuses to change it, as one of a file on the disk does. The folder `data` is embedded with --asset.
// Flags: --asset ./data
const fs = require("node:fs");
const path = require("node:path");
const note = path.join(__dirname, "data", "note.txt");
const show = (what, action) => {
  try {
    console.log(what + ":", action());
  } catch (error) {
    console.log(what + ": threw", error.code, error.syscall);
  }
};
const descriptor = fs.openSync(note, "r");
show("writeSync", () => fs.writeSync(descriptor, "changed"));
show("writeSync at a position", () => fs.writeSync(descriptor, "changed", 0));
show("writevSync", () => fs.writevSync(descriptor, [Buffer.from("changed")]));
show("ftruncateSync refuses", () => {
  try {
    fs.ftruncateSync(descriptor);
    return false;
  } catch {
    return true;
  }
});
show("fstatSync", () => fs.fstatSync(descriptor).size);
show("readSync", () => {
  const bytes = Buffer.alloc(16);
  return bytes.toString("utf8", 0, fs.readSync(descriptor, bytes)).trim();
});
show("readSync at the end", () => fs.readSync(descriptor, Buffer.alloc(16)));
show("readSync at a position", () => {
  const bytes = Buffer.alloc(4);
  return bytes.toString("utf8", 0, fs.readSync(descriptor, bytes, 0, 4, 2));
});
fs.closeSync(descriptor);
show("readlinkSync of the file", () => fs.readlinkSync(note));
show("readlinkSync of its folder", () => fs.readlinkSync(path.dirname(note)));
show("readlinkSync of what is not there", () => fs.readlinkSync(note + ".none"));
(async () => {
  const handle = await fs.promises.open(note, "r");
  console.log(
    "handle.write:",
    await handle.write("changed").then(
      () => "done",
      error => "rejected " + error.code,
    ),
  );
  console.log("handle.readFile:", (await handle.readFile("utf8")).trim());
  await handle.close();
  show("readFileSync", () => fs.readFileSync(note, "utf8").trim());
})();
