// each turn of a self tail call makes a closure over that turn's parameter, and one stores to it
function collect(n: number, made: (() => number)[]): (() => number)[] {
  if (n === 0) return made;
  made.push(() => n++);
  return collect(n - 1, made);
}
function deed(n: number) {
  const made = collect(n, []);
  return made.map(f => f()).join() + ";" + made.map(f => f()).join();
}
console.log(deed(3));
for (let i = 0; i < 4; i++) console.log(deed(4 + i));
console.log(deed(1));
