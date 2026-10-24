// No types are written, and for a long time a function and its callee see objects of one literal only. Then the callee is handed, or stores, something else: the callee's generic version runs below a caller that goes on as before.
let swap = null;
function callee(o, holderObject) {
  if (swap !== null) {
    holderObject.a = swap;
    o = { b: 1, a: 2, c: 3 };
  }
  return o.a + o.b;
}

function holder(o) {
  const before = o.a + o.b;
  const got = callee({ a: 1, b: 2 }, o);
  return before + " " + got + " " + (o.a + o.b) + " " + typeof o.a;
}

for (let round = 0; round < 500; round++) {
  swap = round % 100 === 99 ? [null, "text", 0.5, undefined, { valueOf: () => 7 }, 10n][(round + 1) / 100] : null;
  let line;
  try {
    line = holder({ a: round, b: 1 });
  } catch (error) {
    line = error.name;
  }
  if (swap !== null || round === 0) console.log(round + ": " + line);
}
