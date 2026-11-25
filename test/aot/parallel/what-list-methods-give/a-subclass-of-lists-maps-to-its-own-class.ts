// map, filter and flatMap of an object of a class below Array give an object of that class, beside plain lists at the same calls.
class Stack extends Array<number> { top(): number { return this[this.length - 1] ?? -1; } }
function doubled(list: number[]): number[] { return list.map(x => x * 2); }
function odd(list: number[]): number[] { return list.filter(x => x % 2 === 1); }
function twice(list: number[]): number[] { return list.flatMap(x => [x, x]); }
function tell(out: number[]): string { let sum = 0; for (const x of out) sum += x; return [sum, out.length, Array.isArray(out), out instanceof Stack, out.constructor === Stack, typeof (out as any).top, out.join("-")].join(); }
function walked(list: number[]): string { let sum = 0, turns = 0; try { for (const x of list.map((x: number) => x * 2)) { sum += x; turns++; } for (const x of list.filter((x: number) => x > 1)) { sum += x; turns++; } return sum + "/" + turns + "/" + [...list.map((x: number) => x + 1)].length; } catch (error) { return (error as Error).constructor.name + "/" + sum + "/" + turns; } }
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  said.length = 0;
  const plain = [1, 2, 3, turn];
  const stack = new Stack(); stack.push(1, 2, 3, turn);
  for (const list of [plain, stack, plain]) said.push(tell(doubled(list)), tell(odd(list)), tell(twice(list)));
  said.push(String((doubled(stack) as Stack).top()), walked(plain), walked(stack), walked(plain));
}
console.log(said.join("|")); export {};
