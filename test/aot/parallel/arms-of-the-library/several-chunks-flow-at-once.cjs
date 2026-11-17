const { Readable } = require("node:stream");
const said = [];
const turns = async count => {
  for (let i = 0; i < count; i++) await new Promise(done => setImmediate(done));
};
const chunks = {
  texts: ["a", "bc", "", "def"],
  buffers: [Buffer.from("a"), Buffer.from("bc"), Buffer.alloc(0), Buffer.from("def")],
  objects: [{ length: 3 }, [1, 2], "text", 5, { get length() { said.push("length"); return 2; } }],
};
const encodings = [undefined, "utf8", "hex"];
(async () => {
  for (const kind in chunks) {
    for (const encoding of encodings) {
      for (const how of ["data", "pause", "replaced", "accessor", "readable", "destroy"]) {
        said.length = 0;
        const stream = new Readable({ objectMode: kind === "objects", encoding, read() {} });
        if (how === "replaced") {
          const read = stream.read;
          stream.read = function (amount) {
            said.push("read " + amount);
            return read.call(this, amount);
          };
        }
        if (how === "accessor") Object.defineProperty(stream, "read", { get: () => (said.push("get read"), Readable.prototype.read) });
        try {
          for (const chunk of chunks[kind]) stream.push(chunk);
          stream.push(null);
        } catch (error) {
          said.push(error.code || error.name);
        }
        stream.on("error", error => said.push("error " + (error.code || error.name)));
        stream.on("end", () => said.push("end"));
        if (how === "readable")
          stream.on("readable", () => {
            for (let chunk; (chunk = stream.read()) !== null; ) said.push(String(chunk) + " of " + stream.readableLength);
          });
        else
          stream.on("data", chunk => {
            said.push(String(chunk) + " then " + stream.readableLength);
            if (how === "pause") {
              stream.pause();
              setImmediate(() => stream.resume());
            }
            if (how === "destroy") stream.destroy();
          });
        await turns(8);
        console.log(kind, encoding, how, said.join(", "));
      }
    }
  }
})();
