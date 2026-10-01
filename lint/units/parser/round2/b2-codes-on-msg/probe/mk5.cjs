const fs = require("fs");
const inputs = [
  ["ts", "a < !b;\nexport ;"],
  ["ts", "a < !b;\nexport )"],
  ["ts", "a < !b; export ;"],
  ["ts", "a < !b;\nexport ]"],
  ["ts", "a < !b;\nfunction* g() { yield\n* 1 }"],
  ["ts", "x < !y; export ;"],
  ["ts", "if (a < !b) {}\nexport ;"],
  ["ts", "a < ~b;\nexport ;"],
  ["ts", "a < !b;\na < !b;\nexport ;"],
  ["ts", "export ;"],
];
fs.writeFileSync("inputs5.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs5.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
