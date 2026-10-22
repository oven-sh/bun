const sign = x => (Object.is(x, -0) ? "-0" : String(x));
function neg(x) { return -x; }
function mul(a, b) { return a * b; }
function rem(a, b) { return a % b; }
function div(a, b) { return a / b; }
let line = "";
for (let i = 0; i < 3; i++) line += sign(neg(i)) + " " + sign(mul(i, -1)) + " " + sign(mul(-i, 2)) + " " + sign(rem(-i * 2, 2)) + " " + sign(div(i, -2)) + ";";
console.log(line);
console.log(sign(neg(0)), sign(mul(0, -1)), sign(mul(-3, 0)), sign(rem(-4, 2)), sign(rem(-0, 5)), sign(div(0, -5)), 1 / neg(0), 1 / mul(0, -7));
console.log([Math.round(-0.4), Math.ceil(-0.5), Math.trunc(-0.9), Math.min(0, -0), Math.max(-0, -0), Math.abs(-0), Math.sign(-0), Math.floor(-0), Math.sqrt(-0), Math.cbrt(-0), Math.fround(-0), Math.pow(-0, 3), (-0) ** 1, Math.expm1(-0), Math.sinh(-0), Math.tan(-0), Math.asin(-0), Math.atan2(-0, 1), Math.log1p(-0), Math.imul(-0, 1), Math.clz32(-0)].map(sign).join());
console.log([parseInt("-0"), parseFloat("-0"), Number("-0"), +"-0", -0 + 0, -0 - 0, -0 + -0, 0 - 0, -0 * 1, -(0), -[], -"", -null, -false, ~~-0, -0 | 0, -0 >>> 0].map(sign).join());
const list = [-0, 0];
console.log(list.map(sign).join(), sign(list[0]), list.indexOf(0), list.includes(-0), sign(list.at(0)), sign([...list][0]), sign(list.slice()[0]), sign(list.concat()[0]), sign(Array.from(list)[0]), sign(list.find(() => true)), sign(list.reduce((a, b) => a + b)), sign(Math.min(...list)), sign(list.sort()[0]));
const o = { z: -0 };
console.log(sign(o.z), sign({ ...o }.z), sign(Object.assign({}, o).z), sign(Object.values(o)[0]), sign(structuredClone(o).z), JSON.stringify(o), sign(JSON.parse("-0")), sign(JSON.parse("[-0]")[0]), String(-0), `${-0}`, (-0).toFixed(1), sign(Object.entries(o)[0][1]));
const typed = new Float64Array([-0]);
const ints = new Int32Array([-0]);
console.log(sign(typed[0]), sign(ints[0]), sign(new Float32Array([-0])[0]), sign(typed.at(0)), sign(Array.from(typed)[0]), sign(typed.slice()[0]));
let counter = 0;
for (let i = 3; i >= 0; i--) counter = i * -1;
console.log(sign(counter));
function sumDown(n) { let t = -0; for (let i = 0; i < n; i++) t += -0; return t; }
console.log(sign(sumDown(0)), sign(sumDown(3)));
