const fs = require("node:fs");
const stream = fs.createWriteStream("/dev/null");
let asked = 0;
const watched = new Proxy(stream, {
  get(target, key) {
    if (typeof key === "symbol" && key.description === "kFs") asked++;
    return target[key];
  },
});
stream.once("open", () => {
  fs.WriteStream.prototype._write.call(watched, Buffer.from("x"), "buffer", () => {
    console.log("asked for the file system:", asked);
    const none = new Proxy(stream, {
      get(target, key) {
        if (typeof key === "symbol" && key.description === "kFs") {
          asked++;
          return undefined;
        }
        return target[key];
      },
    });
    asked = 0;
    try {
      fs.WriteStream.prototype._write.call(none, Buffer.from("x"), "buffer", () => {});
    } catch (error) {
      console.log(error.constructor.name, error.message, asked);
    }
    stream.destroy();
  });
});
