// The local is declared in the body of a loop, and the try stands there too: each turn has its own, and closures of earlier turns keep theirs. So many names are stored to under each try that they are kept in fields.
function give(value: number): number { if (value % 3 === 2) throw value; return value; }
function deed(turns: number): string {
  const kept: (() => number)[] = []; const told: number[] = [];
  for (let turn = 0; turn < turns; turn++) {
    let held = -1, plain = -1;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0, a9 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a14 = 0, a15 = 0, a16 = 0, a17 = 0, a18 = 0, a19 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0;
    try { a0 = a1 = a2 = a3 = a4 = a5 = a6 = a7 = a8 = a9 = a10 = a11 = a12 = a13 = a14 = a15 = a16 = a17 = a18 = a19 = a20 = a21 = a22 = a23 = 1; held = turn * 2; plain = turn; held = give(turn) + 100; plain = give(turn + 1); } catch { told.push(held, plain); }
    kept.push(() => held);
  }
  return told.join() + " | " + kept.map(read => read()).join();
}
console.log(deed(7));
