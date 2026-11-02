// A late parameter is set to null, and then something asks for the arguments as they were passed or as they are now.
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : typeof value === "object" ? 7 + (value.id | 0) : 11;
}
function sloppy(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  const before = fold(arguments[13]);
  v11 = null; v9 = null;
  return [before, fold(arguments[13]), fold(arguments[11]), fold(arguments[12]), arguments.length, fold(v11)].join();
}
function strict(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  "use strict";
  v11 = null; v9 = null;
  return [fold(arguments[13]), fold(arguments[11]), fold(arguments[12]), arguments.length, fold(v11)].join();
}
function handsArgumentsOn(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  "use strict";
  v11 = null;
  return strict.apply(null, arguments);
}
function rest(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, ...more) {
  v11 = null; v10 = null;
  return [more.length, more.map(fold).join("/"), fold(v11), fold(v10), fold(v9)].join();
}
function defaults(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10 = { id: 40 }, v11 = { id: 41 }) {
  const first = fold(v11);
  v11 = null;
  return [first, fold(v11), fold(v10), arguments.length].join();
}
function closes(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  const read = () => fold(v11);
  const before = read();
  v11 = null;
  return [before, read()].join();
}
function throws(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  try {
    v11 = null;
    v10.missing.deeper;
  } catch (error) {
    return [error instanceof TypeError, fold(v11), fold(v10), fold(v9)].join();
  }
}
function setsAgain(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  const kept = v11;
  v11 = null;
  const between = fold(v11);
  v11 = kept;
  return [between, fold(v11), fold(kept)].join();
}
function inALoop(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum = (sum * 31 + fold(v11)) | 0;
    v11 = i & 1 ? v10 : null;
  }
  return sum;
}
const o = Array.from({ length: 17 }, (_, id) => ({ id }));
for (const f of [sloppy, strict, handsArgumentsOn, rest, defaults, closes, throws, setsAgain, inALoop]) {
  console.log(f.name, f(...o.slice(0, 14)), "|", f(...o), "|", f(...o.slice(0, 12)));
}
console.log("direct", sloppy(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13]), strict(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13]));
console.log("direct", rest(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13], o[14], o[15]), inALoop(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9], o[10], o[11], o[12], o[13]));
