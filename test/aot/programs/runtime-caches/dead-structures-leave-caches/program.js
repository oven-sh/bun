// A collection removes the cache entries of dead structures and keys, among them a dictionary that was flattened between two reads. The site caches and lookup table rows of live structures stay filled.
// COUNTER: SiteCacheRefill <= 500
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function expectBetween(label, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(label + ": " + value + " is not in " + low + ".." + high); }
const turns = JSON.parse("4");
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; const result = box[0]; box[0] = 0; return result; }
function byName() { return calls("GetByIdAndCache", "PutByIdAndCache", "FillSiteCache"); }

const longLived = [];
for (let i = 0; i < 8; i++) {
  const o = Object.create(null);
  o["own" + i] = i;
  o.shared = i * 3;
  longLived.push(o);
}
function readInTurn(objects, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += objects[i & 7].shared;
  return sum;
}

const stable = Object.create(null);
for (let i = 0; i < 48; i++) stable["p" + i] = i;
function readStable(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += o.p0; sum += o.p1; sum += o.p2; sum += o.p3; sum += o.p4; sum += o.p5; sum += o.p6; sum += o.p7;
    sum += o.p8; sum += o.p9; sum += o.p10; sum += o.p11; sum += o.p12; sum += o.p13; sum += o.p14; sum += o.p15;
    sum += o.p16; sum += o.p17; sum += o.p18; sum += o.p19; sum += o.p20; sum += o.p21; sum += o.p22; sum += o.p23;
    sum += o.p24; sum += o.p25; sum += o.p26; sum += o.p27; sum += o.p28; sum += o.p29; sum += o.p30; sum += o.p31;
    sum += o.p32; sum += o.p33; sum += o.p34; sum += o.p35; sum += o.p36; sum += o.p37; sum += o.p38; sum += o.p39;
    sum += o.p40; sum += o.p41; sum += o.p42; sum += o.p43; sum += o.p44; sum += o.p45; sum += o.p46; sum += o.p47;
  }
  return sum;
}

const letters = JSON.parse('["a","b","c","d","e","f","g","h"]');
function shortLived(round, i) {
  const o = Object.create(null);
  o["r" + round + "_" + i] = 0;
  const rotation = (round * 7 + i) % 8;
  for (let k = 0; k < 8; k++) {
    const index = (k + rotation) % 8;
    o[letters[index]] = (round * 4 + i) * 8 + index;
  }
  return o;
}
function useShortLived(round) {
  const freshKey = "key" + round;
  const freshSymbol = Symbol();
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const o = shortLived(round, i);
    for (let turn = 0; turn < turns; turn++) {
      sum += o.a;
      sum += o.e;
      for (let k = 0; k < 8; k++) sum += o[letters[k]];
    }
    for (let turn = 0; turn < turns; turn++) {
      o[freshKey] = round + turn;
      o[freshSymbol] = round * 2 + turn + i;
      sum += o[freshKey] + o[freshSymbol];
    }
  }
  return sum;
}

function createDictionaryConstructor(round) {
  const constructor = round % 2 ? class { round() { return round; } } : function () { this.round = round; };
  constructor.x = round;
  constructor["round" + round] = 0;
  for (let i = 0; i < 600; i++) constructor["k" + i] = i;
  return constructor;
}
function useDictionaryConstructor(round) {
  const constructor = hidden(createDictionaryConstructor(round));
  const instance = hidden(new constructor());
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += constructor.x;
  if (instance instanceof constructor) sum += 1000;
  for (let turn = 0; turn < turns; turn++) sum += constructor.x;
  return sum;
}

let total = readInTurn(longLived, 32);
for (let round = 0; round < 60; round++) {
  total += useShortLived(round);
  total += useDictionaryConstructor(round);
  if (round % 5 === 4) fullGC();
  else edenGC();
  const before = byName();
  total += readStable(stable, turns);
  if (round > 0) expectBetween("entries for sites whose Structure lives", byName() - before, 0, 0);
  const missesBefore = calls("GetByIdAndCache");
  total += readInTurn(longLived, 32);
  expectBetween("misses for rows whose Structure lives", calls("GetByIdAndCache") - missesBefore, 0, 0);
  if (round % 10 === 9) console.log(total);
}
