// A function that the program calls once makes an object, and a closure that nobody calls names it. Nothing else names the object, so it is let go of while the function waits and behind its return.
let last;
function make(n) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
async function pause(label) {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}

async function namesAConstant(n) {
  const x = make(n);
  const late = () => x.n;
  await pause("a constant, while the function waits");
  return 1;
}
await namesAConstant(0);
await pause("a constant, behind the return");

async function namesAVariable(n) {
  let x = make(n);
  const late = () => x.n;
  if (n) x = null;
  await pause("a variable, while the function waits");
  return 1;
}
await namesAVariable(0);
await pause("a variable, behind the return");

async function namesItInTwoClosures(n) {
  const x = make(n);
  const first = () => x.n;
  const second = () => () => x;
  await pause("two closures, while the function waits");
  return 1;
}
await namesItInTwoClosures(0);
await pause("two closures, behind the return");

async function returnsNothing(n) {
  const x = make(n);
  const late = () => x.n;
  await pause("a function without a return, while it waits");
}
await returnsNothing(1);

function waitsForNothing(n) {
  const x = make(n);
  const late = () => x.n;
  return n;
}
waitsForNothing(0);
await pause("a function that does not wait, behind the return");
