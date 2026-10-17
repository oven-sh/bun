// calls a function that returns nothing through a value, and directly
let counter = 0;
function bump(by: number): void {
  if (by < 0) counter += process.argv.length;
  counter += by;
}
const operations = 100;
const listeners: ((by: number) => void)[] = [];
for (let i = 0; i < operations; i++) listeners.push(bump);
bump(1);
let total = 0;

kernel: {
  for (let i = 0; i < listeners.length; i++) listeners[i](i);
  total += counter;
}

console.log(total);
