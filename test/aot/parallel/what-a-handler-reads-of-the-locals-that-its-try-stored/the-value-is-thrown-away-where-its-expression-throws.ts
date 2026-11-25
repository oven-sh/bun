// The right side of a store under a try throws: the handler reads what the local held before. So many names are stored to under each try that they are kept in fields.
function give(at: number, fails: number): number { if (at === fails) throw new Error("at " + at); return at * 10 + 1; }
function deed(fails: number): string {
  let first = -1, second = -2, third = -3;
  let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0, a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0;
  try { a0 = a1 = a2 = a3 = a4 = a5 = a6 = a7 = a8 = a9 = a10 = a11 = a12 = a13 = a14 = a15 = a16 = a17 = a18 = a19 = a20 = a21 = a22 = a23 = 1; first = give(0, fails); second = give(1, fails); third = give(2, fails); } catch (thrown) { return [first, second, third, (thrown as Error).message].join(); }
  return [first, second, third].join();
}
for (let fails = -1; fails < 3; fails++) console.log(deed(fails));
let told = "";
for (let turn = 0; turn < 200; turn++) told = deed(turn % 4);
console.log(told);
