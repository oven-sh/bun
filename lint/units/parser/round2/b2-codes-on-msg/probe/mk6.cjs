const fs = require("fs");
const inputs = [
  ["ts", "a < b | !c;\nexport ;"],
  ["ts", "a < b | !c; export ;"],
  ["ts", "a < b & !c;\nexport )"],
  ["ts", "x = a < b | !c;\nexport ;"],
  ["ts", "a < b | !c;\na < b | !c;\nexport ;"],
  ["ts", "a < keyof !c;\nexport ;"],
  ["ts", "a < b | !c;\nexport ]"],
  ["ts", "f(a < b | !c);\nexport ;"],
  ["ts", "a < b | !c;\nlet x = 1;\nexport ;"],
  ["ts", "a < b | !c;"],
];
fs.writeFileSync("inputs6.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs6.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
