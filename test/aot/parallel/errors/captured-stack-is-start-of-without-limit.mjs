// What Error.captureStackTrace shows under a limit is the start of what it shows without one: below and above the caller, behind native code, behind suspended async functions, and where one resumed function runs inside another.
import { drainMicrotasks } from "bun:jsc";

let cases = 0;
let empty = 0;
const samples = [];
// The frames of functions, down to the code of the module: what lies below that is not the program's.
function frames(stack) {
  const all = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/\(?[^ ()]*[\\/]([^\\/ ()]+:\d+:\d+)\)?$/, "$1").replace(/\(native:\d+:\d+\)$/, "(native)"));
  const end = all.findIndex(line => !/^at (async )?[\w<>.]+ /.test(line));
  return end < 0 ? all : all.slice(0, end);
}
function absent() {}
function take(caller, limits) {
  const taken = [];
  for (const limit of [Infinity, ...limits]) {
    Error.stackTraceLimit = limit;
    const holder = {};
    Error.captureStackTrace(holder, caller);
    const error = new Error("held");
    Error.captureStackTrace(error, caller);
    taken.push([limit, frames(holder.stack), frames(error.stack)]);
  }
  Error.stackTraceLimit = 10;
  return taken;
}
function judge(name, taken) {
  const [, whole, wholeOnError] = taken[0];
  if (!whole.length) empty++;
  if (whole.length !== wholeOnError.length) console.log("DIFFERS IN LENGTH", name, whole.length, wholeOnError.length);
  for (const [limit, onObject, onError] of taken) {
    cases++;
    if (onObject.join(" < ") !== whole.slice(0, limit).join(" < ")) console.log("DIFFERS", name, limit, "|", onObject.join(" < "), "|", whole.slice(0, limit).join(" < "));
    if (onError.join(" < ") !== wholeOnError.slice(0, limit).join(" < ")) console.log("DIFFERS ON AN ERROR", name, limit, "|", onError.join(" < "), "|", wholeOnError.slice(0, limit).join(" < "));
  }
  if (samples.length < 400 && cases % 7 === 0) samples.push(name + " | " + whole.slice(0, 12).join(" < "));
}
function below(levels, then) {
  const got = levels > 0 ? below(levels - 1, then) : then();
  return got;
}
function above(levels, then) {
  const got = levels > 0 ? above(levels - 1, then) : then();
  return got;
}
function start(then) {
  const got = then();
  return got;
}
const limits = [1, 2, 9, 10, 11, 40];
const depths = [0, 1, 2, 8, 9, 10, 11, 12, 39, 40, 41, 150];

for (const deep of depths) {
  judge("no caller " + deep, below(deep, () => { const got = take(undefined, limits); return got; }));
  judge("a caller that is not there " + deep, below(deep, () => { const got = take(absent, limits); return got; }));
  judge("the function that captures " + deep, below(deep, () => { const got = take(take, limits); return got; }));
  for (const over of depths) {
    judge("start " + deep + " " + over, below(deep, () => { const got = start(() => { const got = above(over, () => { const got = take(start, limits); return got; }); return got; }); return got; }));
    judge("the innermost of many " + deep + " " + over, below(deep, () => { const got = above(over, () => { const got = take(below, limits); return got; }); return got; }));
  }
}

function through(levels, then) {
  let got;
  if (levels === 0) got = then();
  else if (levels % 4 === 0) got = [0].map(() => { const got = through(levels - 1, then); return got; })[0];
  else if (levels % 4 === 1) JSON.stringify([1], function (key, value) { if (key === "0") got = through(levels - 1, then); return value; });
  else if (levels % 4 === 2) JSON.parse("[1]", function (key, value) { if (key === "0") got = through(levels - 1, then); return value; });
  else got = Reflect.apply(through, null, [levels - 1, then]);
  return got;
}
for (const levels of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 20, 41, 90]) {
  judge("through native code " + levels, through(levels, () => { const got = take(undefined, limits); return got; }));
  judge("through native code, not there " + levels, through(levels, () => { const got = take(absent, limits); return got; }));
  judge("through native code, start " + levels, start(() => { const got = through(levels, () => { const got = take(start, limits); return got; }); return got; }));
  judge("through native code, innermost " + levels, through(levels, () => { const got = take(through, limits); return got; }));
}

async function chain(levels, then) {
  if (levels === 0) {
    await 0;
    const got = then();
    return got;
  }
  const got = await chain(levels - 1, then);
  return got;
}
async function first(then) {
  const got = await then();
  return got;
}
for (const waiting of [0, 1, 2, 8, 9, 10, 11, 39, 40, 41, 120])
  for (const deep of [0, 1, 8, 9, 10, 11, 40, 120])
    for (const caller of [undefined, absent, below, chain, first])
      judge("suspended " + waiting + " " + deep + " " + (caller ? caller.name : "no caller"), await first(() => chain(waiting, () => { const got = below(deep, () => { const got = take(caller, limits); return got; }); return got; })));

function drainUntil(out) {
  for (let turn = 0; turn < 400 && !out.length; turn++) drainMicrotasks();
}
async function inner(waiting, deep, caller, out) {
  out.push(await chain(waiting, () => { const got = below(deep, () => { const got = take(caller, limits); return got; }); return got; }));
}
async function middle(between, waiting, deep, caller, out) {
  await chain(2, () => 0);
  const got = [];
  below(between, () => { inner(waiting, deep, caller, got); drainUntil(got); return 0; });
  out.push(got[0]);
}
async function awaitedMiddle(...all) {
  await middle(...all);
}
async function outer(kind, far, between, waiting, deep, caller) {
  await 0;
  const out = [];
  below(far, () => { kind(between, waiting, deep, caller, out); drainUntil(out); return 0; });
  return out[0];
}
async function outermost(...all) {
  const got = await outer(...all);
  return got;
}
function onlyInner(between, waiting, deep, caller, out) {
  inner(waiting, deep, caller, out);
}
for (const kind of [onlyInner, middle, awaitedMiddle])
  for (const far of [0, 3, 12, 45])
    for (const between of kind === onlyInner ? [0] : [0, 3, 12, 45])
      for (const waiting of [0, 3, 12, 45])
        for (const deep of [0, 3, 9, 12, 45])
          for (const caller of [undefined, absent, below, chain, inner, middle, outer])
            judge("resumed inside another " + [kind.name, far, between, waiting, deep, caller ? caller.name : "no caller"].join(" "), await outermost(kind, far, between, waiting, deep, caller));

async function all(then) {
  const got = await Promise.all([chain(3, then), chain(1, () => 1)]);
  return got[0];
}
async function race(then) {
  const got = await Promise.race([chain(3, then)]);
  return got;
}
for (const deep of [0, 9, 45])
  for (const caller of [undefined, below, all, race]) {
    judge("all " + deep + " " + (caller ? caller.name : "no caller"), await all(() => { const got = below(deep, () => { const got = take(caller, limits); return got; }); return got; }));
    judge("race " + deep + " " + (caller ? caller.name : "no caller"), await race(() => { const got = below(deep, () => { const got = take(caller, limits); return got; }); return got; }));
  }

console.log(samples.join("\n"));
console.log(cases, "cases,", empty, "stacks without a frame");
