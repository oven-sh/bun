// A tuple holds a string and a function. The string goes into a function that compares it with a literal and, where they are equal, makes a closure that captures it. Built with --aot-validate.
const made: Record<string, () => any> = { Array: () => "made for Array" };
function makersFor(name: string): Array<() => any> {
  const all: Array<() => any> = [];
  if (name === "Array") all.push(() => made[name]);
  return all;
}
function other(): void {}
const table: Array<[string, () => void]> = [];
table.push(["Array", other]);
table.push(["Map", other]);
for (const [name, handler] of table) {
  handler();
  for (const maker of makersFor(name)) console.log(name, maker()());
}
console.log("done");
