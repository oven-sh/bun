// A prototype that is an object literal keeps the names it gets later beside its fields. Names come and go until those are kept as a dictionary; a store by name then packs them
// anew, and every one of them may lie elsewhere. Heirs that have read a getter, a value and an absent name through the prototype before read them again.
const NAMES = ["key", "next", "method", "other"];
const read = [o => o.key, o => o.next, o => o.method, o => o.other];
const has = [o => "key" in o, o => "next" in o, o => "method" in o, o => "other" in o];
const write = [(o, v) => { o.key = v; }, (o, v) => { o.next = v; }, (o, v) => { o.method = v; }, (o, v) => { o.other = v; }];
const show = v => (typeof v === "function" ? "function" : String(v));
let log = "";

function passingNames(p, count) {
  for (let i = 0; i < count; i++) {
    Reflect.set(p, "passing" + i, i);
    if (i) Reflect.deleteProperty(p, "passing" + (i - 1));
  }
}

function look(heirs) {
  const seen = [];
  for (const o of heirs) {
    for (let k = 0; k < NAMES.length; k++) seen.push(show(read[k](o)) + (has[k](o) ? "+" : "-"));
  }
  return seen.join(" ");
}

function scenario(label, make, rounds) {
  const p = make();
  p.tag = 1;
  const heirs = [];
  for (let i = 0; i < 3; i++) {
    const o = Object.create(p);
    for (let j = 0; j < i; j++) o["own" + j] = j;
    heirs.push(o);
  }
  console.log(label, "start", look(heirs));
  passingNames(p, 40);
  Object.defineProperty(p, "next", { value: 296, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(p, "key", { get() { return "got"; }, set(v) { log += v; }, configurable: true, enumerable: true });
  for (let i = 0; i < rounds; i++) {
    console.log(label, "defined", look(heirs));
    write[0](heirs[i % 3], "s" + i);
  }
  passingNames(p, 61);
  write[2](p, 297);
  for (let i = 0; i < rounds; i++) {
    console.log(label, "stored", look(heirs));
    write[0](heirs[i % 3], "t" + i);
  }
  console.log(label, log, Object.keys(p).join());
}

for (const rounds of [1, 2, 3, 4]) {
  scenario("literal " + rounds, () => ({}), rounds);
  scenario("parsed " + rounds, () => JSON.parse('{"z0":0,"z1":1,"z2":2}'), rounds);
}
