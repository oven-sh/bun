// An object of closures over the scope that made it. The closures are made when they are first read: at once, behind collections, in an old object, and by name.
function counter(start, label) {
  let n = start;
  const seen = [label];
  return {
    add(by) { seen.push(by); return (n += by); },
    get() { return n; },
    async later(by) { await null; return (n += by); },
    describe() { return label + ":" + n + ":" + seen.join("+"); },
    reset() { n = start; seen.length = 1; },
  };
}
const old = [];
for (let i = 0; i < 3000; i++) old.push(counter(i, "c" + i));
Bun.gc(true);
Bun.gc(true);
let garbage = [];
function churn() { for (let i = 0; i < 20000; i++) garbage[i & 1023] = { i, text: "t" + i }; }
let total = 0;
for (let i = 0; i < old.length; i++) total += old[i].add(i & 3);
churn();
Bun.gc(true);
for (let i = 0; i < old.length; i++) total += old[i].add(1) + old[i].get();
churn();
Bun.gc(true);
const lines = [String(total), old[7].describe(), old[2999].describe()];
const sameFunction = old[5].get === old[5].get;
const ownFunction = old[5].get !== old[6].get;
lines.push(String(sameFunction), String(ownFunction), old[5].get.name, String(old[5].add.length), typeof old[5].later);
const name = ["re", "set"].join("");
old[7][name]();
lines.push(old[7].describe(), Object.keys(old[8]).join(), JSON.stringify(old[9]), String("describe" in old[10]));
const taken = old[11].describe;
old[11].add(5);
lines.push(taken(), taken.call(null));
const copy = { ...old[12] };
copy.add(100);
lines.push(old[12].describe(), String(copy.get === old[12].get));
function fresh(i) {
  const c = counter(i, "f");
  garbage[i & 1023] = c;
  c.add(2);
  return c.add(3) + c.get();
}
let sum = 0;
for (let i = 0; i < 200000; i++) sum += fresh(i & 7);
lines.push(String(sum));
const answers = await Promise.all([old[20].later(1), old[21].later(2), old[20].later(3)]);
lines.push(answers.join(), old[20].describe());
console.log(lines.join("\n"));
