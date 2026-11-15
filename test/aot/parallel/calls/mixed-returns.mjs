// A helper in a loop returns an object it just made on some paths and an object it found on others: the caller takes it apart on each path by itself.
// STATISTIC: MixedReturnsWalkedApart >= 1
const log = [];
const shown = { get enter() { log.push("get enter"); return "shown-in"; }, get leave() { log.push("get leave"); return "shown-out"; } };
const odd = new Proxy({ enter: 1 }, { get(target, key) { log.push("proxy " + String(key)); return target[key]; } });
class Pair { constructor(enter) { this.enter = enter; } get leave() { return "pair-" + this.enter; } }
function getEnterLeave(visitor, kind) {
  const found = visitor[kind];
  if (typeof found === "object") return found;
  else if (typeof found === "function") return { enter: found, leave: undefined };
  return { enter: visitor.enter, leave: visitor.leave };
}
const kinds = ["Name", "Field", "Document", "Other", "Last"];
const visitors = [
  { Name() { return 1; }, Field: { enter: "fi", leave: "fo" } },
  { enter() { return 2; }, leave() { return 3; } },
  { Document: shown, Other: odd, Last: new Pair(7) },
  { Field: Object.create({ enter: "above", leave: "higher" }), leave: "only leave" },
  { Name: [1, 2], Last: { leave: 0, enter: false, more: 1 } },
];
const name = value => typeof value === "function" ? "f" + value() : String(value);
function merge(list) {
  const rows = [];
  for (const kind of kinds) {
    let has = false;
    const entered = new Array(list.length).fill(undefined), left = [];
    for (let i = 0; i < list.length; ++i) {
      const { enter, leave } = getEnterLeave(list[i], kind);
      has ||= enter != null || leave != null;
      entered[i] = enter; left.push(leave);
    }
    rows.push(kind + ":" + has + ":" + entered.map(name).join() + ":" + left.map(name).join());
  }
  return rows.join(" ");
}
for (let turn = 0; turn < 3; turn++) console.log(merge(visitors), log.splice(0).join());
try { merge([{ Name: null }]); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }
try { merge([undefined]); } catch (error) { console.log(error.constructor.name); }
// The object that was made is kept, changed or compared on the way.
function pick(source, n) { if (n % 3 === 0) return source.kept; if (n % 3 === 1) return { a: n, b: source.b }; return { a: source.a, b: n }; }
function sum(source, kept) {
  let total = 0, text = "";
  for (let n = 0; n < 12; n++) {
    const it = pick(source, n);
    const { a, b } = it;
    total += a + b; text += a + "/" + b + ";";
    if (n === kept) { it.a = 100; source.kept = it; }
  }
  return total + " " + text + JSON.stringify(source);
}
console.log(sum({ a: 1, b: 2, kept: { a: 5, b: 6 } }, -1));
console.log(sum({ a: 1, b: 2, kept: { a: 5, b: 6 } }, 4));
console.log(sum({ a: "x", b: null, kept: new Pair(3) }, -1));
console.log(sum({ a: 1.5, b: -0, kept: [1] }, 5));
// Ways that bring nothing stand beside ways that bring an object made here and ways that bring another.
function find(map, key) { if (key > 8) return null; if (key & 1) return { value: key, more: map }; return map[key]; }
function present(map) { let count = 0, text = ""; for (let key = 0; key < 12; key++) { const found = find(map, key); if (found) { count++; text += found.value + (found.more === map ? "!" : "?"); } else text += found === null ? "n" : "u"; } return count + text; }
console.log(present({ 0: { value: "zero" }, 2: { value: 2, more: 1 }, 4: "text", 6: 0 }), present([shown, 1, [7]]), log.splice(0).join());
// The handler of the loop's iterator runs where a getter throws.
function* steps() { try { for (const kind of kinds) yield kind; } finally { log.push("closed"); } }
function walk(list, iterable) { let text = ""; for (const kind of iterable) { for (let i = 0; i < list.length; i++) { const { enter, leave } = getEnterLeave(list[i], kind); text += name(enter) + name(leave); } } return text; }
const throwing = { get enter() { throw new RangeError("enter"); } };
for (const iterable of [kinds, steps(), new Set(kinds)]) { try { console.log(walk([{ Name() {} }, { Other: throwing }], iterable)); } catch (error) { console.log(error.constructor.name, error.message, log.splice(0).join()); } }
