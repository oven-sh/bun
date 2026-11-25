class Stack extends Array<number> { top(): number { return this[this.length - 1]; } }
const said: unknown[] = [];
function run(stack: Stack): void {
  for (let round = 0; round < 3; round++) {
    let sum = 0;
    stack.forEach(x => { sum += x + round; });
    said.push(sum, stack.map(x => x * 2).constructor.name, stack.filter(x => x > 1).length, stack.reduce((a, x) => a + x, 0), stack.findLast(x => x < 3), stack.findLastIndex(x => x < 3), stack.reduceRight((a, x) => a + "" + x, ""), stack.flatMap(x => [x, x]).length, stack.top());
  }
}
for (let turn = 0; turn < 200; turn++) { said.length = 0; const stack = new Stack(); stack.push(1, 2, 3); run(stack); }
console.log(said.join(" "));
