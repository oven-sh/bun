// One function, several function objects, one of them given a displayName or a name in the compiler's sight. They are called where the compiler knows the function, in loops, so the calls may be direct or inlined. Each line: the first two frames under the renamed one and under its sibling.
const names = stack =>
  stack
    .split("\n")
    .slice(1, 3)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.mjs:.*$/, "module"),
    )
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const turns = handedBack(3);
let last = "";
let watched = false;

const makeSmall = () =>
  function small(a) {
    if (watched) last = new Error("x").stack;
    return a + 1;
  };
const makeWithCapture = step =>
  function withCapture(a) {
    if (watched) last = new Error("x").stack;
    return a + step;
  };
const makeLeaving = () =>
  function leaving(next, a) {
    if (next) return next(null, a);
    if (watched) last = new Error("x").stack;
    return a + 1;
  };
function under(run) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    watched = i === turns - 1;
    sum += run(i);
  }
  watched = false;
  return names(last);
}
function displayNameInSight() {
  const renamed = makeSmall(),
    sibling = makeSmall();
  renamed.displayName = "renamedSmall";
  console.log(
    "displayName |",
    under(i => renamed(i)),
    "|",
    under(i => sibling(i)),
  );
  handedBack(sibling);
  console.log(
    "displayName, the sibling escaped |",
    under(i => renamed(i)),
    "|",
    under(i => sibling(i)),
  );
}
function nameInSight() {
  const renamed = makeWithCapture(1),
    sibling = makeWithCapture(2);
  Object.defineProperty(renamed, "name", { value: "renamedWithCapture" });
  console.log(
    "name |",
    under(i => renamed(i)),
    "|",
    under(i => sibling(i)),
  );
}
function renamedLater() {
  const renamed = makeSmall(),
    sibling = makeSmall();
  const before = under(i => renamed(i));
  renamed.displayName = "renamedLater";
  console.log(
    "renamed between two loops |",
    before,
    "|",
    under(i => renamed(i)),
    "|",
    under(i => sibling(i)),
  );
}
function leavesByTailCall() {
  const renamed = makeLeaving(),
    sibling = makeLeaving();
  renamed.displayName = "renamedLeaving";
  console.log(
    "tail call |",
    under(i => renamed(sibling, i)),
    "|",
    under(i => sibling(renamed, i)),
    "|",
    under(i => renamed(null, i)),
  );
}
displayNameInSight();
nameInSight();
renamedLater();
leavesByTailCall();
