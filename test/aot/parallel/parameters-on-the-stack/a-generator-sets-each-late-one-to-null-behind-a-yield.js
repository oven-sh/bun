// The same for each of the parameters that come on the stack, and for two of them at once.
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
function drained(steps, stop) {
  let sum = 0;
  try {
    let step = steps.next(0);
    for (let turn = 0; !step.done; turn++) {
      sum = (Math.imul(sum, 31) + step.value) | 0;
      step = turn !== stop ? steps.next(sum & 7) : stop & 1 ? steps.return(sum) : steps.throw(sum & 255);
    }
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
function* each(which, a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  let got = yield fold(a) + fold(b);
  if (which === 0) v4 = null;
  if (which === 1) v5 = null;
  if (which === 2) v6 = null;
  if (which === 3) v7 = null;
  if (which === 4) v8 = null;
  if (which === 5) v9 = null;
  if (which === 6) v10 = null;
  if (which === 7) v11 = null;
  if (which === 8) { v6 = null; v11 = null; }
  got = (got + (yield fold(v0) + fold(v1))) | 0;
  got = (got + (yield fold(v2) + fold(v3))) | 0;
  return (got + fold(v4) + fold(v5) + fold(v6) + fold(v7) + fold(v8) + fold(v9) + fold(v10) + fold(v11)) | 0;
}
for (let which = 0; which < 9; which++) {
  let hash = 0;
  for (let i = 0; i < 9; i++) {
    const o = n => ({ id: i + n });
    hash = (Math.imul(hash, 31) + drained(each(which, o(0), o(1), o(2), o(3), o(4), o(5), o(6), o(7), o(8), o(9), o(10), o(11), o(12), o(13)), 99)) | 0;
  }
  console.log("parameter", which, hash >>> 0);
}
