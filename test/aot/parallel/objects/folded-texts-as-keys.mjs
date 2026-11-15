// Keys of loops that the compiler folds out of texts: templates, trim, case, slices, sums, numbers, a text that names __proto__, and texts that the program spells elsewhere.
const said = [];
function show(o) {
  return JSON.stringify(o) + (Object.getPrototypeOf(o) === Object.prototype ? "" : "/" + JSON.stringify(Object.getPrototypeOf(o)));
}
function template(n) {
  const o = {};
  const key = `we${"ight"}s`;
  for (let i = 0; i < n; i++) o[key] = (o[key] ?? 0) + i;
  return o;
}
function trimmed(n) {
  const o = {};
  const key = "  pri" + "ce ".trim();
  for (let i = 0; i < n; i++) o[key.trim()] = i;
  return o;
}
function upper(n) {
  const o = {};
  const key = "total".toUpperCase();
  let sum = 0;
  for (let i = 0; i < n; i++) {
    o[key] = i;
    sum += o[key];
  }
  return [o, sum];
}
function sliced(o, n) {
  const key = "abcdefgh".slice(2, 5);
  for (let i = 0; i < n; i++) o[key] = i;
  return o;
}
function read(o, n) {
  const key = "x".repeat(3);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o[key] ?? 1;
  return sum;
}
function named(n) {
  const o = { written: 1 };
  const key = "wri" + "tt".concat("en");
  for (let i = 0; i < n; i++) o[key] += i;
  return o;
}
function proto(n) {
  const o = {};
  const key = "__PROTO__".toLowerCase();
  for (let i = 0; i < n; i++) o[key] = { own: i };
  return o;
}
function index(n) {
  const o = {};
  const key = "1" + "2".trim();
  for (let i = 0; i < n; i++) o[key] = i;
  return o;
}
function beside(n) {
  const o = { a: 1 };
  const first = "fir".concat("st"), second = "SECOND".toLowerCase();
  for (let i = 0; i < n; i++) {
    o[first] = o.a;
    o[second] = o[first] + i;
    o.a = o[second];
  }
  return o;
}
function parsed(n) {
  const o = {};
  const key = String(JSON.parse('"par' + 'sed"'));
  for (let i = 0; i < n; i++) o[key] = i;
  for (const name in o) said.push(name);
  return o;
}
for (const n of [0, 1, 4, 40]) {
  said.push(show(template(n)), show(trimmed(n)), upper(n).map(String).join(), show(upper(n)[0]), show(sliced({}, n)), show(sliced({ cde: "held", z: 1 }, n)), show(sliced(Object.create({ cde: 5 }), n)));
  said.push(read({}, n), read({ xxx: 2 }, n), show(named(n)), show(proto(n)), show(index(n)), show(beside(n)), show(parsed(n)));
  for (const o of [[], function f() {}, new Map(), "text", 5]) {
    try {
      said.push(String(sliced(o, n).cde), read(o, n));
    } catch (error) {
      said.push(error.name);
    }
  }
}
console.log(said.join("\n"));
