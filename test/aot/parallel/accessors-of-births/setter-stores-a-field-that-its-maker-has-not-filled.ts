// The body that makes the object stores under the name of the setter, which reads a field that the maker fills later.
type Late = { log: string; late: number; value: number };
function make(seed: number): Late {
  const made = { log: "", set value(next: number) { this.log += next + ":" + this.late + ";"; }, get value(): number { return this.late; } } as Late;
  made.value = seed;
  made.late = seed * 2;
  made.value = seed + 1;
  return made;
}
function main() {
  let joined = "", total = 0;
  for (let i = 0; i < 200; i++) { const made = make(i); if (i < 2) joined += made.log; total += made.value; }
  console.log(joined, total);
}
main();
