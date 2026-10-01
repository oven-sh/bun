const fs = require("fs");
const inputs = [
  ["ts", "let x: ( ;"],
  ["ts", "let x: (;"],
  ["ts", "let x: (a, ;"],
  ["ts", "let x: (A | ) ;"],
  ["ts", "let x: (A | ;"],
  ["ts", "let x: (a: ) ;"],
  ["ts", "type T = { [a + ]: b };"],
  ["ts", "type T = { [a: ]: b };"],
  ["ts", "type T = { [: string]: b };"],
  ["ts", "type T = { [ ]: b };"],
  ["ts", "class C implements a.b( {}"],
  ["ts", "class C implements ; {}"],
  ["ts", "interface I extends ; {}"],
  ["ts", "interface I extends A< {}"],
  ["ts", "let x: import(\"a\", { with: ; });"],
  ["ts", "let x: import(\"a\", { ; });"],
  ["ts", "let x: (A &) ;"],
  ["ts", "let x: (keyof ) ;"],
  ["ts", "let x: (a: string, ;) ;"],
  ["ts", "x as ( ;"],
  ["ts", "x as (A | ) ;"],
  ["ts", "let x: (\n"],
];
fs.writeFileSync("inputs2.json", JSON.stringify(inputs, null, 1));
fs.writeFileSync("inputs2.hex", inputs.map(([k, s], i) => `${i} ${k} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
