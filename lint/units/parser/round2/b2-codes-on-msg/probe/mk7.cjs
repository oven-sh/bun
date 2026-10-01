const fs = require("fs");
const inputs = [["ts", "import * ass x from 'y'"], ["ts", "export * as x frm 'y'"], ["ts", "import x frm 'y'"], ["ts", "async function f() { for await (x in y) {} }"], ["ts", "import {a} frm 'y'"], ["ts", "export {a} frm 'y'"], ["ts", "import type {a} frm 'y'"]];
fs.writeFileSync("inputs7.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs7.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
