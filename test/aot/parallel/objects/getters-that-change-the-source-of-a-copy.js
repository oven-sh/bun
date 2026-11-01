// A getter of the source acts on the source while it is copied. Every kind of source, every act, every kind of copy, several rounds each, on fresh objects and on one object that is emptied and filled again.
const acts = {
  "deletes a later field": s => { delete s.later; },
  "deletes a later added name": s => { delete s["added 1"]; },
  "deletes the last": s => { delete s.last; },
  "deletes everything behind": s => { for (const name of Object.keys(s).slice(1)) if (name !== "counted") delete s[name]; },
  "adds a name": s => { s.fresh = "fresh"; },
  "adds many names": s => { for (let i = 0; i < 40; i++) s["many " + i] = i; },
  "stores to a later field": s => { s.later = "stored"; },
  "stores another kind of value": s => { s.later = 1.5; s.last = { inner: 1 }; },
  "makes a later field an accessor": s => { Object.defineProperty(s, "later", { get() { return "from a getter"; }, enumerable: true, configurable: true }); },
  "hides a later field": s => { Object.defineProperty(s, "later", { enumerable: false }); },
  "hides a later added name": s => { if ("added 1" in s) Object.defineProperty(s, "added 1", { enumerable: false }); },
  "deletes and adds again": s => { const kept = s.later; delete s.later; s.later = kept + " again"; },
  "makes a dictionary": s => { for (let i = 0; i < 80; i++) s["d" + i] = i; for (let i = 0; i < 80; i++) delete s["d" + i]; },
  "adds an element": s => { s[0] = "element"; },
  "adds a far element": s => { s[100000] = "far"; },
  "removes an element": s => { delete s[1]; },
  "changes the prototype": s => { Object.setPrototypeOf(s, { later: "inherited", inherited: 1 }); delete s.later; },
  "freezes": s => { Object.freeze(s); },
  "seals": s => { Object.seal(s); },
  "prevents extensions": s => { Object.preventExtensions(s); },
  "deletes itself": s => { delete s.counted; },
  "replaces itself by a value": s => { Object.defineProperty(s, "counted", { value: "a value", enumerable: true, configurable: true, writable: true }); },
  "adds a symbol": s => { s[Symbol.for("added")] = 1; },
  "deletes a symbol": s => { delete s[Symbol.for("held")]; },
  "copies itself": s => { s.copy = Object.keys({ ...plain(s) }).length; },
  "collects": s => { if (typeof Bun !== "undefined") Bun.gc(true); delete s.later; },
  "throws": s => { delete s.later; throw new Error("thrown by the getter"); },
};
const plain = s => { const made = {}; for (const name of Object.keys(s)) if (name !== "counted") made[name] = 1; return made; };
let act = null, armed = false;
const getter = { get() { if (armed) { armed = false; act(this); } return "counted"; }, enumerable: true, configurable: true };
const fill = {
  "fields": (s, i) => { s.first = 1; Object.defineProperty(s, "counted", getter); s.later = "later"; s.last = "last"; return s; },
  "fields and added names": (s, i) => { s.first = 1; Object.defineProperty(s, "counted", getter); s.later = "later"; for (let at = 0; at < 4; at++) s["added " + at] = at; s.last = "last"; return s; },
  "names of the round": (s, i) => { Object.defineProperty(s, "counted", getter); s.later = "later"; for (let at = 0; at < 6; at++) s["made " + i + " " + at] = at; s["added 1"] = 1; s.last = "last"; return s; },
  "a symbol": (s, i) => { s.first = 1; Object.defineProperty(s, "counted", getter); s.later = "later"; s[Symbol.for("held")] = "held"; s.last = "last"; return s; },
  "elements": (s, i) => { s[1] = "one"; s[2] = "two"; Object.defineProperty(s, "counted", getter); s.later = "later"; s.last = "last"; return s; },
  "two getters": (s, i) => { Object.defineProperty(s, "counted", getter); s.later = "later"; Object.defineProperty(s, "second", { get() { return Object.keys(this).length; }, enumerable: true, configurable: true }); s.last = "last"; return s; },
};
class Held { constructor() { this.first = 0; } }
// Each answers with what makes the source of a round. A kept object is one object for all rounds of a line, emptied and filled again.
const emptied = held => () => { for (const name of Reflect.ownKeys(held)) delete held[name]; return held; };
const sources = {
  "fresh": () => () => ({}),
  "kept": () => emptied({}),
  "kept, with fields": () => emptied({ first: 0, later: "early", last: "early" }),
  "kept, of a class": () => emptied(new Held()),
  "of a class": () => () => new Held(),
  "a literal": () => () => ({ first: 0, later: "early", last: "early" }),
};
const copies = {
  "spread": s => ({ ...s }),
  "spread behind a member": s => ({ head: 1, ...s }),
  "spread in front of a member": s => ({ ...s, later: "written" }),
  "assign": s => Object.assign({}, s),
  "assign onto": s => Object.assign({ head: 1, later: "there" }, s),
  "assign two": s => Object.assign({}, { zero: 0 }, s),
  "rest": s => { const { first, ...rest } = s; return rest; },
  "rest of all": s => { const { ...rest } = s; return rest; },
  "entries": s => Object.fromEntries(Object.entries(s)),
  "values": s => Object.values(s),
  "json": s => JSON.parse(JSON.stringify(s)),
  "clone": s => structuredClone(s),
  "descriptors": s => Object.keys(Object.getOwnPropertyDescriptors(s)),
  "for in": s => { const made = {}; for (const name in s) made[name] = s[name]; return made; },
};
const shown = value => JSON.stringify(value, (key, inner) => (typeof inner === "symbol" ? String(inner) : inner)) + " " + Reflect.ownKeys(Object(value)).filter(key => typeof key === "symbol").map(String).join();
let lines = 0, sum = 0;
const hash = text => { for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; };
const only = typeof process !== "undefined" ? process.argv[2] : undefined;
for (const [nameOfSource, maker] of Object.entries(sources)) for (const [nameOfFill, filled] of Object.entries(fill)) for (const [nameOfAct, acted] of Object.entries(acts)) for (const [nameOfCopy, copy] of Object.entries(copies)) {
  const said = [], make = maker(), isKept = nameOfSource.startsWith("kept");
  for (let round = 0; round < (isKept ? 16 : 6); round++) {
    let source;
    try { source = filled(make(), round); } catch (error) { said.push("no source: " + error.name); continue; }
    act = acted; armed = isKept ? round >= 10 && round !== 13 : round >= 2 && round !== 4;
    try { said.push(shown(copy(source))); } catch (error) { said.push(error.name + ": " + error.message); }
    armed = false;
  }
  const line = [nameOfSource, nameOfFill, nameOfAct, nameOfCopy].join(" | ") + " | " + said.join(" ; ");
  hash(line); lines++;
  if (only === "all" || (only && line.includes(only))) console.log(line);
  else if (lines % 400 === 0) console.log(lines, sum);
}
console.log(lines, "lines", sum);
