// Object.keys and the like of objects with elements under indices: of one structure, each with other indices; holes, doubles, texts, symbols, accessors and unlisted elements, frozen and emptied again.
const S = Symbol("s");
const all = (o) => [Object.keys(o).join(), Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).map(String).join(), Object.values(o).map(String).join(), JSON.stringify(Object.entries(o)), Object.keys({ ...o }).join()].join(" | ");
function make(i) { const o = { b: i }; o[(i * 7) % 5] = i; o[i] = 1; return o; }
for (let i = 0; i < 12; i++) {
  const o = make(i);
  console.log(i, all(o));
  if (i % 3 === 0) o.c = 1;
  if (i % 4 === 1) o[S] = 2;
  if (i % 4 === 2) delete o[i];
  if (i % 4 === 3) o[3] = 0.5;
  console.log(i, all(o));
  delete o.b; o.b = "late"; o[40] = "far";
  console.log(i, all(o));
  if (i % 5 === 0) Object.defineProperty(o, 2, { value: 5, enumerable: false, configurable: true });
  if (i % 5 === 1) Object.defineProperty(o, 1, { get() { return i; }, enumerable: true, configurable: true });
  if (i % 5 === 2) o[5000000] = i;
  if (i % 5 === 3) Object.freeze(o);
  if (i % 5 === 4) for (const key of Object.keys(o)) delete o[key];
  console.log(i, all(o));
}
const N = {}; N[2] = 1; N[1] = 3; N.b = 3; N["-1"] = 4; N["01"] = 5; N[4294967295] = 6; N[4294967294] = 7;
console.log(all(N));
const doubles = { name: 1 }; for (let i = 9; i > 4; i--) doubles[i] = i + 0.5; doubles[6] = NaN;
console.log(all(doubles));
let sum = 0; for (let k = 0; k < 2000; k++) { const o = {}; o[2] = 1; o[1] = k; o.b = 3; sum += Object.keys(o).length + o[1]; } console.log(sum);
