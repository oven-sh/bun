// The body that makes the object reads under the name of the getter before it has stored the field that the getter reads.
type Late = { early: number; late: number; sum: number };
let early = "";
function make(seed: number): Late {
  const made = { early: seed, get sum(): number { return this.early + this.late; } } as Late;
  if (seed < 3) early += made.sum + ",";
  made.late = seed * 2;
  return made;
}
function main() {
  let total = 0;
  for (let i = 0; i < 300; i++) total += make(i).sum;
  console.log(total, early);
}
main();
