// One yield, entered by next(), throw() and return(), and by what its own operand is fulfilled or rejected with.
async function* made(operand) {
  try {
    if (yield operand) return "early";
    return "late";
  } catch (error) {
    console.log("caught", typeof error, String(error));
    return "caught";
  } finally {
    console.log("finally");
  }
}
async function show(step) {
  try {
    console.log(JSON.stringify(await step));
  } catch (error) {
    console.log("threw", typeof error, String(error));
  }
}
const entries = [
  walk => walk.next(1),
  walk => walk.next(0),
  walk => walk.throw(new Error("thrown in")),
  walk => walk.return(7),
  walk => walk.return(Promise.reject(new Error("rejected return"))),
];
const operands = [
  () => 5,
  () => Promise.resolve(6),
  () => Promise.reject(new Error("broken")),
  () => ({
    then() {
      throw new Error("then throws");
    },
  }),
];
for (const enter of entries) {
  for (const operand of operands) {
    const walk = made(operand());
    await show(walk.next(1));
    await show(enter(walk));
    await show(walk.next(1));
  }
}
