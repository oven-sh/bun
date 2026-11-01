// A function object that nothing refers to any more while its own call still runs: its frame keeps the name that is written, and takes none that another function object of the same function was given.
function make(tag) {
  return function work(run, depth) {
    return (depth ? work(run, depth - 1) : run(tag)) + "";
  };
}
function makePlain(tag) {
  return function plain(run) {
    return run(tag) + "";
  };
}
function rename(target, name) {
  target.displayName = name;
}
function frames() {
  Bun.gc(true);
  return String(new Error("here").stack)
    .split("\n")
    .map(line => line.trim().split(" ")[1])
    .filter(name => /^(work|plain|renamed)/.test(name))
    .join(" ");
}
const unknown = JSON.parse("[0]")[0];
const renamed = make("a");
rename(unknown ? {} : renamed, "renamedWork");
const renamedPlain = makePlain("a");
rename(unknown ? {} : renamedPlain, "renamedPlain");

console.log("renamed, held:", renamedPlain(() => frames()));
console.log("not renamed, held by nobody:", makePlain("b")(() => frames()));
console.log("renamed, held by nobody:", (made => (rename(unknown ? {} : made, "renamedToo"), made))(makePlain("c"))(() => frames()));
console.log("renamed, held, calls itself:", renamed(() => frames(), 2));
console.log("not renamed, held by nobody, calls itself:", make("d")(() => frames(), 2));
for (let turn = 0; turn < 3; turn++) console.log("in a loop:", makePlain("e" + turn)(() => frames()), renamedPlain(() => frames()));
const kept = makePlain("f");
console.log("not renamed, held:", kept(() => frames()));
rename(unknown ? {} : kept, "renamedLater");
console.log("renamed later:", kept(() => frames()));
console.log("renamed in its own call:", kept(() => (rename(unknown ? {} : kept, "renamedInside"), frames())));

const count = text => text.split(" ").reduce((counts, name) => ((counts[name] = (counts[name] ?? 0) + 1), counts), {});
console.log("deep, held by nobody:", JSON.stringify(count(make("g")(() => frames(), 300))));
console.log("deep, renamed:", JSON.stringify(count(renamed(() => frames(), 300))));
console.log("below a host function:", [1, 2].map(each => makePlain("h" + each)(() => frames())).join(" | "));
console.log("below a host function, renamed:", [1].map(() => renamedPlain(() => [2].map(() => makePlain("i")(() => frames())).join())).join());
console.log("below a sort:", [2, 1].sort((a, b) => (makePlain("j")(() => frames()) === "plain" ? a - b : 0)).join());

function cut(above) {
  Bun.gc(true);
  const holder = {};
  Error.captureStackTrace(holder, above);
  return String(holder.stack)
    .split("\n")
    .map(line => line.trim().split(" ")[1])
    .filter(name => /^(work|plain|renamed|outer)/.test(name))
    .join(" ");
}
function outer(run) {
  return run() + "";
}
console.log("cut above a function that is held:", outer(() => kept(() => cut(kept))));
console.log("cut above one that is not on the stack:", outer(() => makePlain("k")(() => cut(renamed))));

function makeAsync(tag) {
  return async function workLater(run) {
    await tag;
    return run() + "";
  };
}
function* steps(run) {
  yield run() + "";
}
function makeSteps(tag) {
  return function* workInSteps(run) {
    yield tag;
    yield run() + "";
  };
}
function later() {
  Bun.gc(true);
  return String(new Error("here").stack)
    .split("\n")
    .map(line => line.trim().replace(/^at (async )?/, "").split(" ")[0])
    .filter(name => /^(work|renamed|steps)/.test(name))
    .join(" ");
}
const renamedLater = makeAsync("l");
rename(unknown ? {} : renamedLater, "renamedAsync");
const renamedSteps = makeSteps("m");
rename(unknown ? {} : renamedSteps, "renamedSteps");
console.log("a generator, held by nobody:", [...makeSteps("n")(later)][1]);
console.log("a generator, renamed:", [...renamedSteps(later)][1]);
console.log("a generator function that is made once:", [...steps(later)][0]);
console.log("an async function, held by nobody:", await makeAsync("o")(later));
console.log("an async function, renamed:", await renamedLater(later));
console.log("two at once:", (await Promise.all([makeAsync("p")(later), renamedLater(later), makeAsync("q")(later)])).join(" | "));
