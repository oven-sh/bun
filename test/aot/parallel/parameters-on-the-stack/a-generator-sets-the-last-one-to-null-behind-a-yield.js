// A generator with more parameters than there are registers for them sets the last one to null behind a yield. By then it runs in another frame, which whoever called next() entered it from.
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
function* late(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) {
  let got = yield (a + b) | 0;
  got = (got + (yield (v0 + v1) | 0)) | 0;
  v11 = null;
  got = (got + (yield (v2 + v3) | 0)) | 0;
  got = (got + (yield (v4 + v5 + v6) | 0)) | 0;
  return (got + v7 + v8 + v9 + fold(v11)) | 0;
}
let hash = 0;
for (let i = 0; i < 21; i++) hash = (Math.imul(hash, 31) + drained(late(i, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, { id: i }), 99)) | 0;
console.log("behind two yields", hash >>> 0);
