"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const file = path.join(os.tmpdir(), "a-name-tells-the-receiver-" + process.pid + ".bin");
fs.writeFileSync(file, Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 255))); const bytes = fs.readFileSync(file); fs.unlinkSync(file);
const key = JSON.parse('"go"');
const readers = { go(b, limit) { let s = 0; for (let i = 0; i + 4 <= limit; i += 4) s = (s + b.readUInt32LE(i) + b.readInt16BE(i) + b.readUInt8(i)) % 65521; return s; } };
const turns = +(process.argv[2] ?? 50);
let caught = "none"; try { readers[key](bytes, 300); } catch (error) { caught = error.code ?? error.constructor.name; }
console.log(readers[key](bytes, turns), readers[key](bytes, 256), caught);
