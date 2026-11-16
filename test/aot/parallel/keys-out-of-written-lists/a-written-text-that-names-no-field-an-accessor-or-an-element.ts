class Peg {
  x = 1; y = 2;
  get twice(): number { return this.x * 2; }
  set twice(v: number) { this.x = v / 2; }
}
function read(peg: any): string {
  let all = "";
  for (const name of ["x", "none", "twice", "0", "y", "constructor"]) all += typeof peg[name] + ":" + (typeof peg[name] === "function" ? "f" : String(peg[name])) + " ";
  return all;
}
function store(peg: any): void {
  for (const name of ["twice", "late", "0"]) peg[name] = 10;
}
function asks(peg: any): string {
  let all = "";
  for (const name of ["x", "none", "twice"]) all += (name in peg) + " ";
  for (const name of ["late", "x"]) all += delete peg[name];
  return all;
}
function leaves(peg: Peg): number {
  let total = 0;
  for (const name of ["x", "y", "x"] as const) { if (total > 5) break; if (peg[name] === 2) continue; total += peg[name] * 3; }
  return total;
}
const peg = new Peg();
const said = [read(peg), leaves(peg)];
store(peg);
said.push(read(peg), asks(peg), read(peg));
console.log(said.join("| "));
