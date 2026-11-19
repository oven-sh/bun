// Elements of lists go through a function that hands them to another one: numbers, texts, mixed kinds, holes, getters.
const whole = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 61).join() + "]");
const doubles = whole.map(v => v / 4);
const negative = whole.map(v => -v);
const texts = JSON.parse('["1","2","x",""]');
const mixed = JSON.parse('[1,"2",4.5,null,[6],true,{"v":10},-0,1e300,2147483647]');
const holes = [1, , 3];
let state = 0;

const add = v => v + 1;
const double = v => v * 2;
const bits = v => v | 0;
const throughAdd = v => add(v);
const throughDouble = v => double(v);
const throughBits = v => bits(v);
const twice = v => throughAdd(v);
const inTry = v => {
  try {
    return double(v);
  } finally {
    state++;
  }
};
const inCatch = v => {
  try {
    if (v === 37) throw new Error("37");
    return add(v);
  } catch (error) {
    return error.message.length;
  }
};
const least = (v, w) => (v < w ? v : w);
const throughLeast = v => least(v, 7);
const kept = [];
const keeps = v => {
  kept.push(v);
  if (kept.length > 4) kept.length = 0;
  return add(v);
};

function sum(list, f) {
  let s = 0;
  for (let i = 0; i < list.length; i++) s = s + f(list[i]);
  return s;
}
function sumAdd(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (s + throughAdd(list[i])) | 0; return s; }
function sumDouble(list) { let s = 0; for (let i = 0; i < list.length; i++) s += throughDouble(list[i]); return s; }
function sumBits(list) { let s = 0; for (const v of list) s = (s + throughBits(v)) | 0; return s; }
function sumTwice(list) { let s = 0; for (let i = 0; i < list.length; i++) s += twice(list[i]); return s; }
function sumTry(list) { let s = 0; for (let i = 0; i < list.length; i++) s += inTry(list[i]); return s; }
function sumCatch(list) { let s = 0; for (let i = 0; i < list.length; i++) s += inCatch(list[i]); return s; }
function sumLeast(list) { let s = 0; for (let i = 0; i < list.length; i++) s += throughLeast(list[i]); return s; }
function sumKeeps(list) { let s = 0; for (let i = 0; i < list.length; i++) s += keeps(list[i]); return s; }

for (let turn = 0; turn < 60; turn++) {
  for (const list of [whole, doubles, negative, texts, mixed, holes, []]) {
    const results = [sumAdd(list), sumDouble(list), sumBits(list), sumTwice(list), sumTry(list), sumCatch(list), sumLeast(list), sumKeeps(list), sum(list, throughAdd), sum(list, inTry)];
    if (turn % 59 === 0) console.log(results.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(" | "), state, kept.length);
  }
}
