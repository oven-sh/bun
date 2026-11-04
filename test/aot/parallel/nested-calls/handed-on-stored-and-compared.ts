function each(list: number[], f: (x: number) => void) { for (const x of list) f(x); }
function outer(list: number[]) {
  let sum = 0;
  const holder = { f: add };
  each(list, add);
  add(100);
  holder.f(1000);
  return [sum, holder.f === add, add === add, typeof add, add.name, add.length] as const;
  function add(x: number) { sum += x; }
}
console.log(JSON.stringify(outer([1, 2, 3])));
