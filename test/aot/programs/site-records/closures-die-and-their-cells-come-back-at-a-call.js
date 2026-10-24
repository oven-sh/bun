// A call site meets a closure, the closure dies, and a collection later other closures, of other code, stand where it stood. The site calls each of them, not what it remembers.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

function callIt(callee) {
  return callee(1);
}
function callMethod(holder) {
  return holder.act(2);
}
function construct(callee) {
  return new callee(3).made;
}

function firstKind(captured) {
  return function (argument) {
    return "first " + captured + " " + argument;
  };
}
function secondKind(captured) {
  return function (argument) {
    return "second " + captured + " " + argument;
  };
}
function thirdKind(captured) {
  return argument => "third " + captured + " " + argument;
}
function firstMaker(captured) {
  return function (argument) {
    this.made = "made first " + captured + " " + argument;
  };
}
function secondMaker(captured) {
  return function (argument) {
    this.made = "made second " + captured + " " + argument;
  };
}

function teach(round) {
  // Only this frame holds the closures.
  return [callIt(unknown(firstKind(round))), callMethod(unknown({ act: firstKind(round) })), construct(unknown(firstMaker(round)))].join(" | ");
}
function fillStack(depth) {
  const some = [depth, depth + 1, depth + 2, depth + 3];
  return depth ? fillStack(depth - 1) + some.length : 0;
}

let wrong = 0;
function check(actual, expected) {
  if (actual !== expected) {
    wrong++;
    if (wrong < 10) console.log("WRONG:", actual, "instead of", expected);
  }
}

for (let round = 0; round < 6; round++) {
  console.log(teach(round));
  console.log(teach(round));
  fillStack(50);
  Bun.gc(true);
  const kept = [];
  for (let i = 0; i < 3000; i++) {
    const kind = i % 3;
    const callee = kind === 0 ? secondKind(i) : kind === 1 ? thirdKind(i) : firstKind(i);
    const name = kind === 0 ? "second " : kind === 1 ? "third " : "first ";
    kept.push(callee);
    check(callIt(unknown(callee)), name + i + " 1");
    check(callMethod(unknown({ act: callee })), name + i + " 2");
    const maker = i % 2 ? secondMaker(i) : firstMaker(i);
    kept.push(maker);
    check(construct(unknown(maker)), (i % 2 ? "made second " : "made first ") + i + " 3");
  }
  console.log("round", round, "kept", kept.length, "wrong", wrong);
}

export {};
