const { Writable } = require("node:stream");
process.on("uncaughtException", e => console.log(e.message.replace(/ \(In .*/, "")));
const w = new Writable({ write(chunk, encoding, callback) { callback(); } });
w.destroy = 7;
w.end();
