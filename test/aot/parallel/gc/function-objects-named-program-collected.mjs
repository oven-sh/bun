// Each function object of the factory gets a name of its own and shows it in its stack frame. Once its call has returned and nothing else holds it, it is collected.
const make = name =>
  Object.defineProperty(
    function () {
      return new Error("x").stack.split("\n")[1].trim().split(" ")[1];
    },
    "name",
    { value: name },
  );
const watched = [];
function watch(made) {
  watched.push(new WeakRef(made));
  return made;
}
function callOnce(name) {
  return watch(make(name))();
}
function callFarDown(name, depth) {
  return depth ? callFarDown(name, depth - 1) : callOnce(name);
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
async function callBehindAnAwait(name) {
  await turn();
  return watch(make(name))();
}
function callInATimer(name) {
  return new Promise(resolve => setTimeout(() => resolve(watch(make(name))()), 0));
}

console.log(callOnce("inAFunction"), callFarDown("farDown", 20), watch(make("atTheTopLevel"))());
console.log(await callBehindAnAwait("behindAnAwait"), await callInATimer("inATimer"));
for (let round = 0; round < 3; round++) {
  await turn();
  Bun.gc(true);
}
console.log(watched.map(weak => (weak.deref() === undefined ? "collected" : "held")).join());
