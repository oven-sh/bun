// reads through a getter that lies far out of line in objects with hundreds of getters
const operations = 100;
function viewOf(seed: number): any {
  const view = { kept: seed };
  for (let i = 0; i < 300; i++) Object.defineProperty(view, "g" + i, { get() { return this.kept + i; }, enumerable: true, configurable: true });
  return view;
}
const views = [viewOf(1), viewOf(2), viewOf(3), viewOf(4)];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += views[i & 3].g250;
  total += sum;
}

console.log(total);
