// Each function object of the factory gets a name of its own, and only its call holds it. A collection that runs during the call leaves it alone: its stack frame shows its name afterwards. The first collection behind the call collects it, however far down that collection is started.
// Flags: --aot-disable=flow-results
const watched = [];
const nameOf = made => Object.getOwnPropertyDescriptor(made, "name").value;
function make(name, run) {
  const made = Object.defineProperty(
    function () {
      const below = run();
      const shown = new Error("x").stack.split("\n")[1].trim().split(" ")[1];
      return below ? shown + ">" + below : shown;
    },
    "name",
    { value: name },
  );
  watched.push(new WeakRef(made));
  return made;
}
function collect() {
  Bun.gc(true);
  // Whatever was collected makes room for these.
  let length = 0;
  for (let i = 0; i < 3000; i++)
    length += nameOf(Object.defineProperty(function () {}, "name", { value: "other" + i })).length;
  return length > 0 ? "" : "none";
}
function collectFarDown(depth) {
  return depth ? collectFarDown(depth - 1) : collect();
}
function callFarDown(call, depth) {
  const shown = depth ? callFarDown(call, depth - 1) : call();
  return shown;
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

const ways = {
  inPlace: name => {
    const shown = make(name, collect)();
    return shown;
  },
  collectionFarDown: name => make(name, () => collectFarDown(40))(),
  callFarDown: name => callFarDown(() => make(name, collect)(), 40),
  asTheLastCall: name => make(name, collect)(),
  belowMap: name => [0].map(make(name, collect))[0],
  belowApply: name => Reflect.apply(make(name, collect), undefined, []),
  belowCall: name => make(name, collect).call(undefined),
  belowAGetter: name => Object.defineProperty({}, "x", { get: make(name, collect) }).x,
  belowStringify: name => JSON.parse(JSON.stringify({ toJSON: make(name, collect) })),
  belowReplace: name => "x".replace("x", make(name, collect)),
  oneInAnother: name => make(name, () => make(name + "Inner", collect)())(),
  oneInAnotherBelowMap: name => make(name, () => [0].map(make(name + "Inner", () => collectFarDown(10)))[0])(),
  manyInOneAnother: name => {
    const nest = depth => make(name + depth, () => (depth ? nest(depth - 1) : collect()))();
    return nest(300).split(">").length;
  },
  oneAfterAnother: name => [make(name + 1, collect)(), make(name + 2, collect)(), make(name + 3, collect)()].join(),
};
async function behindAnAwait(name) {
  await turn();
  return make(name, collect)();
}
function inATimer(name) {
  return new Promise(resolve => setTimeout(() => resolve(make(name, collect)()), 0));
}
function inAHandler(name) {
  return Promise.resolve().then(() => make(name, collect)());
}

for (const way in ways) console.log(way, ways[way](way));
console.log(await behindAnAwait("behindAnAwait"), await inATimer("inATimer"), await inAHandler("inAHandler"));
await turn();
collectFarDown(5);
console.log(watched.length, watched.filter(weak => weak.deref() !== undefined).length);
