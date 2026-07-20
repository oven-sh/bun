// Copied from WebKit JSTests/microbenchmarks/string-equality-long-16bit.js and
// string-equality-256-16bit.js.
// Not a mitata benchmark: run directly with `bun string-equality-16bit.mjs`.
const noInline = globalThis.noInline ?? (() => {});

function makeString(len, ch) {
  let s = "";
  for (let i = 0; i < len; ++i) s += ch;
  return s;
}

function eqLong(x, y) {
  return x === y;
}
noInline(eqLong);

function eq256(x, y) {
  return x === y;
}
noInline(eq256);

{
  // Two distinct JSString cells with identical 16-bit content (avoid pointer-equal fast path).
  const a = makeString(64, "α") + "β";
  const b = makeString(64, "α") + "β";
  const c = makeString(64, "α") + "γ";

  let n = 0;
  const t0 = performance.now();
  for (let i = 0; i < 1e6; ++i) {
    if (eqLong(a, b)) n++;
    if (eqLong(a, c)) n++;
  }
  const t1 = performance.now();
  if (n !== 1e6) throw new Error("bad result: " + n);
  console.log("=== 65-char 16-bit strings x 1e6: ".padEnd(36), (t1 - t0).toFixed(2), "ms");
}

{
  const a = makeString(255, "α") + "β";
  const b = makeString(255, "α") + "β";
  const c = makeString(255, "α") + "γ";

  let n = 0;
  const t0 = performance.now();
  for (let i = 0; i < 1e6; ++i) {
    if (eq256(a, b)) n++;
    if (eq256(a, c)) n++;
  }
  const t1 = performance.now();
  if (n !== 1e6) throw new Error("bad result: " + n);
  console.log("=== 256-char 16-bit strings x 1e6:".padEnd(36), (t1 - t0).toFixed(2), "ms");
}
