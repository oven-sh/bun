class Stack extends Array<number> {}
function tell(value: string | number[]): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
function count(value: string | number[], rounds: number): number { let total = 0; for (let round = 0; round < rounds; round++) { if (Array.isArray(value)) total += value.length; else for (const unit of value) total += unit.length; } return total; }
function only(value: number[] | undefined): unknown { return Array.isArray(value) ? value.length : typeof value; }
const stack = new Stack();
stack.push(1, 2, 3);
const made: number[][] = [stack, stack.map(x => x + 1), stack.filter(x => x > 1), stack.slice(1), stack.concat([4]), stack.splice(0, 1), stack.flat() as number[], stack.flatMap(x => [x, x]), Stack.of(7, 8), Stack.from([9]), Array.from.call(Stack, [1, 2]) as number[], Reflect.construct(Array, [2], Stack) as number[], Reflect.construct(Stack, [], Array) as number[], Object.setPrototypeOf([1, 2], Stack.prototype), Object.setPrototypeOf(new Stack(4), Array.prototype), stack.toSorted(), stack.toReversed(), stack.with(0, 5), [...stack], Array.from(stack)];
for (let round = 0; round < 3; round++) console.log(made.map(list => tell(list) + ":" + count(list, 2) + ":" + only(list)).join(" "), tell("ab"), count("ab", 2), only(undefined));
