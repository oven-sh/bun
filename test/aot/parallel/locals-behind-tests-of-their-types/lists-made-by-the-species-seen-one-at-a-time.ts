class Stack extends Array<number> {}
function tellMapped(value: string | number[]): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
function tellSliced(value: string | number[]): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
function tellOf(value: string | number[]): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
function tellConstructed(value: string | number[]): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
function tellStack(value: string | Stack): string { return Array.isArray(value) ? "list" + value.length : "text" + value.length; }
const stack = new Stack();
stack.push(1, 2, 3);
for (let round = 0; round < 3; round++) console.log(tellMapped(stack.map(x => x + 1)), tellMapped("a"), tellSliced(stack.slice(1)), tellSliced("b"), tellOf(Stack.of(7, 8)), tellOf("c"), tellConstructed(Reflect.construct(Array, [2], Stack) as number[]), tellConstructed("d"), tellStack(stack), tellStack("e"));
