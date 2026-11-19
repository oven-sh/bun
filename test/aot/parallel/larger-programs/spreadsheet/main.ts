// Cells with formulas: a parser, a graph of what depends on what, cycles, ranges, functions, undo and columns that are sorted, in two modules
import { Address, Sheet } from "./lib";
const sheet = new Sheet();
let dirtied = 0;
sheet.watchers.push(() => dirtied++);
sheet.batch(() => {
  for (let r = 1; r <= 60; r++) sheet.set("A" + r, String(r * 3 % 17)).set("B" + r,
    `=A${r}*2+${r % 5}`).set("C" + r, r === 1 ? "=B1" : `=C${r - 1}+B${r}`).set("D" + r,
    `=IF(C${r}>500,"big",ROUND(C${r}/7,1))`);
  sheet.set("E1", "=SUM(A1:B60)").set("E2", "=AVG(C1:C60)").set("E3",
    "=MAX(A1:A60)-MIN(B1:B60)").set("E4", '="n="&COUNT(A1:D60)').set("E5",
    "=LOOKUP(9,A1:A60,C1:C60)").set("E6", "=2^3^2-(1+2)*-4");
});
console.log(sheet.print(5, 8));
for (const [at, text] of [["F1", "=F2"], ["F2", "=F3+1"], ["F3", "=F1"], ["G1", "=1/0"], ["G2",
  "=G1+1"], ["G3", '="a"+1'], ["G4", "=NOPE(1)"], ["G5", "=LOOKUP(99,A1:A60,C1:C60)"], ["G6",
  "=IF(1>2,G1,7)"]]) {
  sheet.set(at, text);
}
console.log(["F1", "F2", "F3", "G1", "G2", "G3", "G4", "G5",
  "G6"].map(at => at + "=" + sheet.value(at)).join(" "));
for (const bad of ["=1+", "=(1", "=SUM(1", "=$", "=A1:2"]) try {
  sheet.set("H1", bad);
  console.log("fine", bad);
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
try {
  sheet.set("1A", "x");
} catch (e) {
  console.log((e as Error).message);
}
let mixed = 0;
for (let i = 0; i < 1500; i++) {
  sheet.set("A" + (1 + (i * 7) % 60), String((i * 31) % 23));
  mixed = (mixed * 31 + Math.round((sheet.value("E1") as number) + (sheet.value("E2") as number) * 10) + String(sheet.value("D60")).length) >>> 0;
  if (i % 50 === 0) {
    sheet.undo();
    sheet.undo();
    mixed += sheet.value("C60") as number;
    sheet.redo();
  }
}
console.log(mixed, sheet.evaluated, dirtied);
let undone = 0;
while (sheet.undo()) undone++;
console.log(undone, sheet.value("E1"), sheet.cell("A1").kind, sheet.redo(), sheet.value("E1"),
  Address.print(701, 9), Address.parse("AAA10").join());
