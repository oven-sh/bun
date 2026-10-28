// Prints what a variable holds after `variable = Symbol() + ""` has thrown inside a `try`, beside three sums that throw in other ways. Plain Bun prints another output.
let atTheTop = 0;
try {
  atTheTop = Symbol() + "";
} catch (error) {
  console.log("caught", error.constructor.name);
}
console.log("at the top:", typeof atTheTop);

function inAFunction() {
  let kept = 0;
  try {
    kept = Symbol() + "";
  } catch (error) {
    console.log("caught", error.constructor.name);
  }
  return typeof kept;
}
console.log("in a function:", inAFunction());

function aCallOnTheLeft(make) {
  let kept = 0;
  try {
    kept = make() + 1n;
  } catch (error) {
    console.log("caught", error.constructor.name);
  }
  return typeof kept + " " + kept;
}
console.log(
  "a call on the left:",
  aCallOnTheLeft(() => 5),
);

function aMemberOnTheLeft(o) {
  let kept = "before";
  try {
    kept = o.x * 2n;
  } catch (error) {
    console.log("caught", error.constructor.name);
  }
  return kept;
}
console.log("a member on the left:", aMemberOnTheLeft({ x: 5 }));

function inAFinally() {
  let kept = 0;
  try {
    try {
      kept = Symbol() + "";
    } finally {
      console.log("in a finally:", typeof kept);
    }
  } catch {}
}
inAFinally();
