// What stands between the declaration of a constant and the `return` that gives it back runs.
let n = 0;
function f() {
  const c = "abcdef".charCodeAt(3);
  n++;
  return c;
}
console.log(f(), n);

function loops() {
  const c = "abcdef".charCodeAt(1);
  for (let i = 0; i < 3; i++) n += i;
  return c;
}
console.log(loops(), n);

function leavesEarly(early) {
  const c = "abcdef".charCodeAt(2);
  if (early) return 0;
  return c;
}
console.log(leavesEarly(true), leavesEarly(false));

function throws() {
  const c = "abcdef".charCodeAt(4);
  throw new Error("thrown");
  return c;
}
try {
  console.log(throws());
} catch (error) {
  console.log(error.message);
}

function returnsSomethingElse() {
  const c = "abcdef".charCodeAt(5);
  const g = () => c;
  console.log("after");
  return 2;
}
console.log(returnsSomethingElse());

function returnsWhatAnInnerFunctionGives() {
  const c = "abcdef".charCodeAt(0);
  function g() {
    return c;
  }
  n++;
  return g() + 1;
}
console.log(returnsWhatAnInnerFunctionGives(), n);

const holder = {
  get got() {
    const c = "abcdef"["charCodeAt"](3);
    n++;
    return c;
  },
};
console.log(holder.got, n);

async function waits() {
  const c = "abcdef".charCodeAt(3);
  await null;
  n++;
  return c;
}

function* yields() {
  const c = "abcdef".charCodeAt(3);
  yield "yielded";
  return c;
}
console.log([...yields()], yields().next());

function namesItTwice() {
  const first = "abcdef".charCodeAt(3);
  const c = first;
  n++;
  return c;
}
console.log(namesItTwice(), n);

function returnsAtOnce() {
  const c = "abcdef".charCodeAt(3);
  return c;
}
console.log(returnsAtOnce());

console.log(await waits(), n);
