// 10,800 stores of true, false, null and nothing go into views of nine kinds, inside, beyond the end and below 0, through a function that knows neither the view, the position nor the value: each is held against the rule, the neighbours stay, and none leaves for the run time.
// COUNT: operation:operationAOTPutByVal <= 100
'use strict';
const z = JSON.parse('0'), any = x => [x][z], put = (v, i, x) => { v[i] = x; };
const V = [true, false, null, undefined], K = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array], bad = [];
for (const C of K) {
  const float = C === Float32Array || C === Float64Array, v = new C(3); let n = 0;
  for (let r = 0; r < 100; r++) for (const x of V) {
    v[1] = 7; put(any(v), any(1), any(x)); put(any(v), any(3), any(x)); put(any(v), any(-1), any(x));
    if (!Object.is(v[1], x === true ? 1 : x === undefined && float ? NaN : 0) || v[0] !== 0 || v[2] !== 0) n++;
  }
  bad.push(n);
}
console.log(bad.join());
