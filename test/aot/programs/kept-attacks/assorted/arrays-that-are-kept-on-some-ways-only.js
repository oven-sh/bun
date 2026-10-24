// A function like the `debug` of npm: it takes its arguments in a rest array, returns at once while it is switched off, and changes and keeps the array while it is switched on.
// The compiler may leave the array in the caller's frame and move it to the heap where the function begins to look at it. Nobody may be able to tell. The output is that of plain Bun.
const lines = [];
const show = (...values) => lines.push(values.map(value => (Array.isArray(value) ? "[" + value.join() + "]" : String(value))).join(" "));
const opaque = value => (lines.length < 0 ? null : value);

let enabled = false;
const kept = [];
function log(...args) {
  if (!enabled) return 0;
  args[0] = "changed " + args[0];
  args.push("pushed");
  kept.push(args);
  return args.length;
}
function keepsList(list, flag) {
  if (!flag) return "left";
  list.unshift("first");
  kept.push(list);
  return list;
}
function returnsList(list, flag) {
  if (flag) return list;
  return null;
}
function passesOn(list, flag) {
  if (!flag) return "left";
  return keepsList(list, flag > 1);
}
function throwsWith(list, flag) {
  if (!flag) return "left";
  list.push("before the throw");
  kept.push(list);
  throw new Error("thrown with " + list.length);
}
function captures(list, flag) {
  if (!flag) return () => "left";
  return () => list;
}
function keepsInTry(list, flag) {
  try {
    if (flag) {
      kept.push(list);
      list.length = 1;
    }
  } finally {
    lines.length += 0;
  }
  return flag;
}
function recurses(list, depth) {
  if (!depth) return "bottom";
  if (depth === 1) {
    kept.push(list);
    return list;
  }
  return recurses(list, depth - 1);
}
async function keepsLater(list, flag) {
  if (!flag) return "left";
  await null;
  kept.push(list);
  return list;
}
function* yieldsList(list, flag) {
  if (!flag) return;
  yield list;
  yield list;
}
class Logger {
  on = false;
  write(...args) {
    if (!this.on) return;
    this.last = args;
    args.reverse();
  }
}

function looksAgain(a, flag) {
  const list = [a, "again"];
  const result = keepsList(list, flag);
  return [result === list, list];
}
function handsTwice(a, flag) {
  const list = [a, "twice"];
  return [keepsList(list, flag), keepsList(list, flag), list];
}
function growsList(list, flag) {
  if (!flag) return 0;
  list.push("grown");
  return list.length;
}
function handsInLoop(a, flag) {
  const list = [a, "loop"];
  const lengths = [];
  for (let i = 0; i < 3; i++) lengths.push(growsList(list, flag));
  return lengths;
}
function makesInLoop(a, flag) {
  const lengths = [];
  for (let i = 0; i < 3; i++) lengths.push(growsList([a, i], flag));
  return lengths;
}
function maybeList(list, flag) {
  if (!flag) return "left";
  kept.push(list);
  return list;
}
function keepsInCatch(list, flag) {
  try {
    if (flag) throw new Error("caught inside");
    return "left";
  } catch (error) {
    kept.push(list);
    list.push(error.message);
    return list;
  }
}
function keepsInFinally(list, flag) {
  let result = "left";
  try {
    if (!flag) return result;
    result = "went on";
  } finally {
    if (result !== "left") kept.push(list);
  }
  return list;
}
function keepsTwoLists(first, second, flag) {
  if (!flag) return "left";
  first.push(second);
  second.push("second");
  kept.push(first, second);
  return first.length + second.length;
}
class Holder {
  constructor(list, flag) {
    this.held = "nothing";
    if (flag) {
      this.held = list;
      list.push("held");
    }
  }
}
function fillsStack(depth) {
  return depth ? fillsStack(depth - 1) + depth : 0;
}

for (let round = 0; round < 6; round++) {
  enabled = round % 2 === 1;
  const flag = enabled;
  const before = kept.length;
  show("log", log(round, "a", "b"), opaque(log)(round, "c"), log(), opaque(log)());
  show("list", keepsList([round, "x"], flag), opaque(keepsList)([round, "y"], flag));
  show("returned", returnsList([round, "r"], flag), opaque(returnsList)([round], flag));
  show("passed on", passesOn([round, "p"], flag ? 2 : 0), passesOn([round, "q"], flag ? 1 : 0));
  try {
    show("no throw", throwsWith([round, "t"], flag));
  } catch (error) {
    show("caught", error.message, kept.at(-1));
  }
  const closure = captures([round, "captured"], flag);
  fillsStack(50);
  show("closure", closure(), closure() === closure());
  show("try", keepsInTry([round, "u", "v"], flag), kept.at(-1));
  show("recursion", recurses([round, "deep"], flag ? 5 : 0));
  show("async", await keepsLater([round, "later"], flag));
  show("generator", ...yieldsList([round, "yielded"], flag));
  const logger = opaque(new Logger());
  logger.on = flag;
  logger.write(round, "w1", "w2");
  fillsStack(50);
  show("method", logger.last);
  show("again", ...looksAgain(round, flag));
  show("twice", ...handsTwice(round, flag));
  show("loop", handsInLoop(round, flag), makesInLoop(round, flag));
  show("catch", keepsInCatch([round, "c"], flag), opaque(keepsInCatch)([round, "d"], flag));
  show("finally", keepsInFinally([round, "f"], flag));
  show("two lists", keepsTwoLists([round, "one"], [round, "two"], flag), kept.at(-1), kept.length);
  const same = [round, "same"];
  show("one list twice", keepsTwoLists(same, same, flag));
  const holder = new Holder([round, "h"], flag);
  fillsStack(50);
  show("constructor", holder.held, opaque(new Holder([round, "i"], flag)).held);
  show("not always a list", maybeList([round, "m"], flag), maybeList(round, flag), maybeList(undefined, flag), maybeList("text", flag));
  fillsStack(100);
  if (typeof Bun !== "undefined") Bun.gc(true);
  show("kept", kept.length - before, ...kept.slice(before));
}
show("distinct", kept.length, new Set(kept).size);
console.log(lines.join("\n"));
