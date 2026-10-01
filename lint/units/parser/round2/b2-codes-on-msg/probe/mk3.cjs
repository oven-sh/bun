const fs = require("fs");
const inputs = [
  ["ts", "'\\"], ["ts", "x = '\\"], ["ts", "`\\"], ["ts", "x = `a\\"], ["ts", "'a\\\\"], ["ts", "x = 'a\\\\"],
  ["ts", "\"\\\n"], ["ts", "'\\u"], ["ts", "'\\x"], ["ts", "x = 'abc\\"], ["ts", "x = \"a\\\r\n"], ["ts", "x = 'a\\\nb"], ["ts", "x = `a${b}c\\"], ["ts", "x = `a${b}c"],
  ["ts", "`a${"], ["ts", "x = '\\\\\\"],
];
fs.writeFileSync("inputs3.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs3.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
