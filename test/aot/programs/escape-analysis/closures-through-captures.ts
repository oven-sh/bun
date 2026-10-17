// A function value that an inner function declaration has captured is called from there.
function outer(list: number[], check: (x: number) => boolean): number {
  function one(x: number, depth: number): number {
    if (depth > 3) return 0;
    if (x > 100) return one(x - 100, depth + 1);
    if (x > 50) return one(x - 50, depth + 1) + 1;
    return check(x) ? 1 : x > 10 ? one(x - 10, depth + 1) : 0;
  }
  let count = 0;
  for (let i = 0; i < list.length; i++) count += one(list[i], 0);
  if (list.length > 5) count += one(list[5], 1);
  return count;
}
function maker(limit: number): number { //! frame
  let seen = 0;
  const over = (x: number): boolean => { seen++; return x > limit; }; //! frame
  return outer([1, 2, 3, 60, 170], over) * 1000 + outer([4, 5, 26, 7, 8, 9], over) * 10 + seen;
}
// Not optimized yet: a constant that an inner function captures together with variables that change goes through the environment as the front end emits it, with a store, so the closure is a cell.
function makerCaptures(limit: number): number { //! heap
  let seen = 0;
  const under = (x: number): boolean => { seen++; return x < limit; }; //! heap
  function twice(x: number, depth: number): number {
    if (depth > 2) return 0;
    if (x > 40) return twice(x - 40, depth + 1);
    return (under(x) ? 1 : 0) + (under(x + 1) ? 1 : 0) + (x > 20 ? twice(x - 20, depth + 1) : 0);
  }
  return twice(3, 0) + twice(limit, 0) + twice(55, 0) + twice(25, 1) + seen * 100;
}
let out = "";
for (let i = 0; i < 60; i++) {
  const a = maker(i % 7), b = makerCaptures(i % 9);
  if (i % 15 === 0) out += a + "|" + b + "\n";
}
console.log(out);
