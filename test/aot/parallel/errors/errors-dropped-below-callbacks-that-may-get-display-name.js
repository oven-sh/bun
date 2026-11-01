// Errors are made and dropped below callbacks that are made anew for each call and handed on. One statement stores a displayName through a value that nobody follows, as react's memo() and forwardRef() do with what they are handed.
// Any of the callbacks may be the function that was renamed, so a frame of theirs is named by the function object that ran in it.
// A stack that nobody has read yet is kept as return addresses, with those function objects beside them. Every one of these 24,000 was once walked until the first such frame, given up and listed frame by frame.
// COUNT: made:StackListingsAfterGivenUpCaptures <= 0
const fs = require("node:fs");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
function component() {}
handedBack(component).displayName = "Shown";

const names = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/ ?\(.*\)$/, ""),
    )
    .filter(name => !name.includes("/") && !name.includes("\\"))
    .join(" < ");

let kept = [];
function made(path) {
  const error = new Error(path);
  if (kept.length < 4) kept.push(error);
  return error.message.length;
}
function missing(path) {
  try {
    return fs.statSync(path).size;
  } catch (error) {
    if (kept.length < 4) kept.push(error);
    return 1;
  }
}
function thrown(path) {
  try {
    return path.nothing.here;
  } catch (error) {
    if (kept.length < 4) kept.push(error);
    return 1;
  }
}
function step2(path, visit) {
  return visit(path) + 1;
}
function step1(path, visit) {
  return step2(path, visit) + 1;
}
function work(list, probe, k) {
  const visit = handedBack(function visit(path) {
    return probe(path + k) + 1;
  });
  const each = handedBack(function each(path) {
    return [step1(path, visit)];
  });
  const result = list.flatMap(each).length;
  return { result, visit, each };
}

const list = ["/nowhere/a", "/nowhere/b", "/nowhere/c", "/nowhere/d"];
for (const probe of [made, missing, thrown]) {
  kept = [];
  let sum = 0;
  let first;
  for (let i = 0; i < 2000; i++) {
    const { result, visit, each } = work(list, probe, i & 3);
    sum += result;
    first ??= { visit, each };
  }
  console.log(probe.name, sum);
  console.log("as written |", names(kept[0].stack));
  // The stacks were taken before the names were given and are read behind them.
  handedBack(first.visit).displayName = "visited";
  console.log("one named |", names(kept[1].stack));
  handedBack(first.each).displayName = "for each";
  console.log("both named |", names(kept[2].stack));
  delete handedBack(first.visit).displayName;
  console.log("one again as written |", names(kept[3].stack));
  // Other function objects of the same two functions ran in these.
  kept = [];
  work(list, probe, 0);
  console.log("others |", names(kept[0].stack));
}

// Fewer frames are wanted than there are.
for (const limit of [1, 2, 3, 4, 100]) {
  Error.stackTraceLimit = limit;
  kept = [];
  const { visit, each } = work(list, made, 0);
  handedBack(visit).displayName = "visited";
  handedBack(each).displayName = "for each";
  console.log("limit", limit, "|", names(kept[0].stack));
}
