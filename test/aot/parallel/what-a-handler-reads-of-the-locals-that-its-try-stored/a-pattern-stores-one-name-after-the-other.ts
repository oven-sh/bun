// A destructuring assignment under the try stores name by name: the getter of the third throws. So many names are stored to under each try that they are kept in fields.
function deed(fails: boolean): string {
  let first = 0, second = 0, third = 0;
  const from = { a: 1, b: 2, get c(): number { if (fails) throw 0; return 3; } };
  let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0, a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0;
  try { a0 = a1 = a2 = a3 = a4 = a5 = a6 = a7 = a8 = a9 = a10 = a11 = a12 = a13 = a14 = a15 = a16 = a17 = a18 = a19 = a20 = a21 = a22 = a23 = 1; ({ a: first, b: second, c: third } = from); } catch { return "caught " + [first, second, third].join(); }
  return "end " + [first, second, third].join();
}
console.log(deed(false), deed(true));
function swap(fails: boolean): string {
  let left = 1, right = 2;
  const pair = { *[Symbol.iterator]() { yield right; if (fails) throw 0; yield left; } };
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, b7 = 0, b8 = 0, b9 = 0, b10 = 0, b11 = 0, b12 = 0, b13 = 0, b14 = 0, b15 = 0, b16 = 0, b17 = 0, b18 = 0, b19 = 0, b20 = 0, b21 = 0, b22 = 0, b23 = 0;
  try { b0 = b1 = b2 = b3 = b4 = b5 = b6 = b7 = b8 = b9 = b10 = b11 = b12 = b13 = b14 = b15 = b16 = b17 = b18 = b19 = b20 = b21 = b22 = b23 = 1; [left, right] = pair; } catch { return "caught " + left + " " + right; }
  return "end " + left + " " + right;
}
console.log(swap(false), swap(true));
