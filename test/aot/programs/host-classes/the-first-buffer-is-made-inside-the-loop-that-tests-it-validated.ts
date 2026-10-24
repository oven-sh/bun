// The realm makes the Structure of Buffer when Buffer is first used. Here that is inside the loop whose calls rely on a Buffer as created.
let sink: unknown;
const works: Record<string, (n: number) => unknown> = {
  "Buffers": n => { let s = 0; for (let i = 0; i < n; i++) { const b = Buffer.from("text " + i); s += b.toString("hex").length + b.toString("base64").length + Buffer.concat([b, b]).length + b.readUInt8(0) + b.indexOf("x") + Buffer.byteLength("é" + i) + +b.subarray(1).equals(b.subarray(1)); } return s; },
};
for (const name in works) for (let round = 0; round < 3; round++) sink = works[name](2000);
console.log(sink);
