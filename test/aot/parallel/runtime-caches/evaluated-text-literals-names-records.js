// Evaluated text literals with the names of compiled records.
const lines = [];
function show(label, value) {
  lines.push(label + " " + JSON.stringify(value, (key, item) => (item === undefined ? "<undefined>" : typeof item === "function" ? "<function>" : typeof item === "bigint" ? item + "n" : typeof item === "symbol" ? String(item) : item)));
}
const evaluate = (...list) => new Function(...list);

function payload(value) {
  return { value, issues: [] };
}
function total(p) {
  return p.issues.length + (typeof p.value === "number" ? p.value : 0);
}
function push(p, issue) {
  p.issues.push(issue);
  return p;
}
function describe(p) {
  return [Reflect.ownKeys(p).map(String), Object.getOwnPropertyDescriptors(p), Object.getPrototypeOf(p) === Object.prototype, JSON.stringify(p), { ...p }, Object.entries(p)];
}
function forIn(p) {
  const names = [];
  for (const name in p) names.push(name);
  return names;
}

const leak = evaluate("p", "return p");
leak(payload(0));

const same = evaluate("v", "return { value: v, issues: [] };");
const swapped = evaluate("v", "return { issues: [], value: v };");
const fewer = evaluate("v", "return { value: v };");
const more = evaluate("v", "return { value: v, issues: [], extra: v };");
const between = evaluate("v", "return { value: v, extra: v, issues: [] };");
const odd = evaluate("v", "return { value: v, issues: v };");

const makers = { payload, same, swapped, fewer, more, between };
for (let turn = 0; turn < 30; turn++) {
  for (const name in makers) {
    const made = makers[name](turn);
    if (made.issues) total(push(made, turn));
  }
}
for (const name in makers) {
  const made = makers[name](7);
  show(name, [describe(made), forIn(made), made.issues ? total(made) : "no issues"]);
}

for (const value of [undefined, null, true, 1.5, -0, 2 ** 40, "text", 10n, Symbol.for("s"), () => 1, [1], { a: 1 }, new Map()]) {
  const made = same(value);
  show("value " + typeof value, [Object.is(made.value, value), total(made), Object.keys(made)]);
  const strange = odd(value);
  let answer;
  try {
    answer = total(strange);
  } catch (error) {
    answer = error.constructor.name;
  }
  show("issues " + typeof value, [Object.is(strange.issues, value), answer]);
}

function change(label, action) {
  for (const maker of [payload, same]) {
    const made = maker(1);
    let result;
    try {
      result = action(made);
    } catch (error) {
      result = String(error);
    }
    show(label + " " + maker.name, [result, describe(made), forIn(made)]);
  }
}
change("delete and add again", p => { delete p.value; p.value = 2; return total(p); });
change("delete both", p => { delete p.value; delete p.issues; return Object.keys(p).length; });
change("add names", p => { p.aborted = true; p[0] = "zero"; p[Symbol.for("k")] = 1; return total(p); });
change("an accessor in place of a field", p => { Object.defineProperty(p, "value", { get() { return 41; }, enumerable: true, configurable: true }); return total(p); });
change("not enumerable", p => { Object.defineProperty(p, "issues", { enumerable: false }); return total(p); });
change("read-only", p => { Object.defineProperty(p, "value", { writable: false }); p.value = 9; return total(p); });
change("frozen", p => { Object.freeze(p); p.value = 9; p.more = 1; return [total(p), Object.isFrozen(p)]; });
change("sealed", p => { Object.seal(p); p.value = 9; delete p.issues; return [total(p), Object.isSealed(p)]; });
change("not extensible", p => { Object.preventExtensions(p); p.more = 1; return [total(p), Object.isExtensible(p)]; });
change("another prototype", p => { Object.setPrototypeOf(p, { inherited: 5 }); return [total(p), p.inherited]; });
change("no prototype", p => { Object.setPrototypeOf(p, null); return [total(p), "toString" in p]; });
change("assigned from another", p => { Object.assign(p, { issues: [1, 2], value: 3, other: 4 }); return total(p); });
change("structured clone", p => total(structuredClone(p)));

const read = evaluate("p", "return [p.value, p.issues.length, 'value' in p, 'missing' in p, p.missing, Object.keys(p).join()];");
const store = evaluate("p", "v", "p.value = v; p.issues = [v]; p.added = v; return p;");
for (let turn = 0; turn < 30; turn++) {
  read(payload(turn));
  read(same(turn));
  store(payload(turn), turn);
  store(same(turn), turn);
}
show("read in evaluated text", [read(payload(1)), read(same(1))]);
show("stored in evaluated text", [describe(store(payload(1), 2)), describe(store(same(1), 2))]);

const kept = [];
for (let turn = 0; turn < 30000; turn++) kept.push(turn & 1 ? same(turn) : payload(turn));
if (typeof Bun !== "undefined") Bun.gc(true);
let sum = 0;
for (const item of kept) sum += total(push(item, 1));
show("kept across collections", sum);

console.log(lines.join("\n"));
