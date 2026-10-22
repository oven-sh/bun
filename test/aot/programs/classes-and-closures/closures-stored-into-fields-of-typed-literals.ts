// One declared type, many ways to make a value of it: literals with arrow members in several functions, members stored later, members left out, copies by spread and Object.assign,
// members taken from other objects, and untyped code that stores what it likes.
interface Tools {
  label: string;
  first: () => number;
  second: () => string;
  third: (source: string) => string;
  own: () => string;
  late?: () => string;
  maybe?: () => number;
}
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
let calls = 0;
function count() {
  return ++calls;
}

function full(label: string): Tools {
  const tools = {
    label,
    first: () => count(),
    second: () => "second",
    third: source => source + "!",
  } as Tools;
  tools.own = () => tools.label + " owns";
  return tools;
}
function other(label: string): Tools {
  const tools: Tools = {
    label,
    first: () => 7,
    second: () => "other second",
    third: source => source + "?",
    own: () => "nobody owns",
  };
  return tools;
}
function withLate(label: string, late: boolean): Tools {
  const tools = full(label);
  if (late) tools.late = () => tools.label + " is late";
  return tools;
}
function copyOf(tools: Tools): Tools {
  return { ...tools, second: () => "copied second" };
}
function relabeled(tools: Tools, label: string): Tools {
  return { ...tools, label };
}
function assigned(tools: Tools): Tools {
  return Object.assign({} as Tools, tools, { maybe: () => 1 });
}
function borrowed(from: Tools, label: string): Tools {
  return { label, first: from.first, second: from.second, third: from.third, own: from.own };
}
function shared(label: string): Tools {
  const second = () => "shared second";
  const tools: Tools = { label, first: () => 1, second, third: source => second() + source, own: () => label };
  return tools;
}
function use(tools: Tools, n: number): string {
  switch (n % 5) {
    case 0:
      return String(tools.first());
    case 1:
      return tools.second();
    case 2:
      return tools.third("x");
    case 3:
      return tools.own();
    default:
      return (tools.late ? tools.late() : "no late") + (tools.maybe ? tools.maybe() : "");
  }
}

const makers: ((i: number) => Tools)[] = [
  i => full("full" + i),
  i => other("other" + i),
  i => withLate("late" + i, i % 2 === 0),
  i => copyOf(full("copied" + i)),
  i => relabeled(full("before" + i), "relabeled" + i),
  i => assigned(full("assigned" + i)),
  i => borrowed(full("lender" + i), "borrower" + i),
  i => shared("shared" + i),
];
const made: Tools[] = [];
for (let i = 0; i < 80; i++) made.push(makers[i % makers.length](i));
// Read only after all of them are made.
const used: string[] = [];
for (let i = 0; i < made.length; i++) used.push(use(made[i], i >> 3));
for (let i = 0; i < made.length; i += 16) say("used", used.slice(i, i + 16).join());
say("keys", made.slice(0, 8).map(tools => Object.keys(tools).join("+")).join());
say("identity", made.every(tools => tools.first === tools.first && tools.own === tools.own && tools.third === tools.third), made[0].first !== made[8].first, made[1].second !== made[9].second);

// A copy holds the very functions of its source, read or not.
const source = full("source");
const ownBefore = source.own;
const copy = copyOf(source);
const renamed = relabeled(source, "renamed");
say("copies", copy.first === source.first, copy.own === ownBefore, copy.second !== source.second, renamed.own === source.own, renamed.own(), renamed.label, copy.own());
const unread = full("unread");
const copyOfUnread = relabeled(unread, "copy");
say("copy of unread", copyOfUnread.own === unread.own, copyOfUnread.third === unread.third, copyOfUnread.own(), unread.own());
const lender = full("lender");
const borrower = borrowed(lender, "borrower");
say("borrowed", borrower.own === lender.own, borrower.own(), borrower.first === lender.first);

// Stores from outside, typed.
const changed = full("changed");
const firstBefore = changed.first;
changed.first = () => 100;
changed.second = other("x").second;
changed.own = () => changed.label + " changed";
say("stores", changed.first(), firstBefore !== changed.first, changed.second(), changed.own(), changed.first === changed.first, Object.keys(changed).join());
changed.late = undefined;
say("undefined stored", changed.late, "late" in changed, Object.keys(changed).join());
delete changed.late;
delete changed.maybe;
say("deleted", "late" in changed, Object.keys(changed).join());

// Stores from outside, untyped.
function meddle(value: any, name: string, stored: unknown) {
  value[name] = stored;
  return value;
}
const meddled = full("meddled");
meddle(meddled, "first", 5);
meddle(meddled, "own", function (this: Tools) {
  return "own of " + this.label;
});
meddle(meddled, "third", lender.third);
meddle(meddled, "added", () => "added");
say("meddled", (meddled as any).first, meddled.own(), meddled.third === lender.third, (meddled as any).added(), Object.keys(meddled).join());
function callFirst(tools: Tools) {
  try {
    return String(tools.first());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
say("called after meddling", callFirst(meddled), callFirst(full("fine")), callFirst(other("fine")));

// The same functions for many objects, made in a loop and kept.
const pool: Tools[] = [];
for (let i = 0; i < 50; i++) pool.push(i % 10 === 0 ? other("o" + i) : full("f" + i));
let total = 0;
for (const tools of pool) total += tools.first() + tools.own().length + tools.third("ab").length;
say("pool", total, new Set(pool.map(tools => tools.first)).size, new Set(pool.map(tools => tools.own)).size);

console.log(lines.join("\n"));
