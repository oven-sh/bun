class Peg { x = 1; y = 2; z = 3; }
function swapped(peg: Peg): number {
  const sides: ("x" | "y" | "z")[] = ["x", "y", "z"];
  let total = 0;
  for (const side of sides) { total = total * 10 + peg[side]; sides[2] = "x"; }
  return total;
}
function grown(peg: Peg): number {
  const sides: ("x" | "y" | "z")[] = ["x", "y"];
  let total = 0;
  for (const side of sides) { total = total * 10 + peg[side]; if (sides.length < 4) sides.push("z"); }
  return total;
}
function cut(peg: Peg): number {
  const sides: ("x" | "y" | "z")[] = ["x", "y", "z"];
  let total = 0;
  for (const side of sides) { total = total * 10 + peg[side]; sides.length = 2; }
  return total;
}
function touch(sides: string[]): void { sides[1] = "z"; }
function handedOut(peg: Peg): number {
  const sides: ("x" | "y" | "z")[] = ["x", "y", "z"];
  let total = 0;
  for (const side of sides) { total = total * 10 + peg[side]; touch(sides); }
  return total;
}
const peg = new Peg();
console.log(swapped(peg), grown(peg), cut(peg), handedOut(peg));
