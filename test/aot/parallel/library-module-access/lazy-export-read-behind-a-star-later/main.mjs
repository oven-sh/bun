// The namespace object is made for a call. The lazy exports of node:os and node:fs are read through it afterwards, by a key that the build does not know.
import * as all from "./again.mjs";
console.log(typeof all.hostname());
const keys = JSON.parse('["EOL", "tmpdir", "ReadStream", "promises", "absent"]');
for (const key of keys) console.log(key, typeof all[key], key in all);
console.log(JSON.stringify(all.EOL), all.tmpdir === all.tmpdir, all.ReadStream === all.ReadStream);
console.log(Object.keys(all).filter(key => keys.includes(key)).join());
