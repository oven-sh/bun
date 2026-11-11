const out = [];
const show = v => typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v instanceof Error ? v.name : String(v);
const list = JSON.parse('[3,1.5,"x",null,-2,true]');
const seen = new WeakMap();
let sites = 0;
function lengths(strings, ...values) { let t = strings[0].length; for (let j = 0; j < values.length; j++) t += values[j] + strings[j + 1].length; return t; }
function text(strings, ...values) { let t = strings[0]; for (let j = 0; j < values.length; j++) t += String(values[j]) + strings[j + 1]; return t; }
function broken(strings, ...values) { let t = strings.length; for (let j = 0; j < strings.length; j++) t += ":" + (strings[j] === undefined ? strings.raw[j] : strings[j]); return t + values.length; }
function odd(strings, ...values) { return [strings[values.length], strings[values.length + 1], strings[-1], strings[0.5], strings["0"], strings["length"], strings.at(-1), strings.raw.length]; }
function site(strings) { if (!seen.has(strings)) seen.set(strings, ++sites); return seen.get(strings); }
function frozen(strings) { const told = []; for (const change of [() => { strings[0] = "w"; }, () => { strings.length = 0; }, () => { strings.push("x"); }, () => { strings.raw[0] = "w"; }, () => { strings.extra = 1; }, () => { delete strings[0]; }]) { try { change(); told.push("done"); } catch (error) { told.push(error.name); } } return told.concat(Object.isFrozen(strings), Array.isArray(strings), strings[0], strings.length); }
const spread = (strings, ...values) => [...strings, ...values].length + strings.concat(values).length;
const named = { tag(strings, value) { return this.k + strings[0] + value + strings[1]; }, k: "k" };
function run() {
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    out.push(lengths`a${i}b${i + 1}cc`, text`<p class="${i}">${x}</p>`, text`none`, text`${x}`, show(broken`\u{${x}\xg`), show(odd`a${x}b`), site`same${x}`, site`other`, show(frozen`f${x}`), spread`${1}${2}`, named.tag`[${x}]`, String.raw`a\n${x}`, (strings => strings[0] + strings.length)`here`);
  }
}
for (let round = 0; round < 2; round++) run();
for (let i = 0; i < 3; i++) out.push(lengths`m${i}`, text`${list[i]}m`, site`module`);
console.log(out.join("\n"));
