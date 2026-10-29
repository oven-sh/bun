// The streams of node:fs are loaded before node:fs/promises, and take a FileHandle all the same. A read replaced on its prototype afterwards is called.
const fs = require("node:fs");
console.log(typeof fs.ReadStream, typeof fs.WriteStream);
const os = require("node:os");
const path = require("node:path");
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "handles-")), "a.txt");
(async () => {
  const written = await fs.promises.open(file, "w");
  const output = fs.createWriteStream(null, { fd: written });
  await new Promise(resolve => output.on("close", resolve).end("late"));
  console.log(output.bytesWritten, written.fd);

  const handle = await fs.promises.open(file, "r");
  const prototype = Object.getPrototypeOf(handle);
  const original = prototype.read;
  prototype.read = function (...operands) {
    console.log("the replaced read");
    return original.apply(this, operands);
  };
  let text = "";
  for await (const chunk of fs.createReadStream(null, { fd: handle, encoding: "utf8" })) text += chunk;
  prototype.read = original;
  console.log(text, handle.fd);

  for (const fd of [null, {}, "1"]) {
    try {
      fs.createReadStream(null, { fd });
    } catch (error) {
      console.log(error.code);
    }
  }
  fs.rmSync(path.dirname(file), { recursive: true });
})();
