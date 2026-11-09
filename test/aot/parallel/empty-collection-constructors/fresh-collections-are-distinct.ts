function make() { return new Map<string, number>(); }
function run() {
  const first = make();
  const second = make();
  first.set("a", 1);
  return (first === second) + " " + first.size + " " + second.size;
}
console.log(run(), run());
