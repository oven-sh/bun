// A function that runs again returns another symbol each time: by two calls, in a loop, by recursion, as a callback.
function show(label, value) {
  console.log(label, typeof value === "symbol" ? String(value) : value);
}

function make() { return Symbol("dog"); }
const first = make();
const second = make();
show("two calls differ", first !== second);
show("two calls ==", first == second);
const both = { [first]: 1, [second]: 2 };
show("two keys", Object.getOwnPropertySymbols(both).length);
show("first", both[first]);
show("second", both[second]);

function makeInLoop() { return Symbol("loop"); }
const made = [];
for (let i = 0; i < 3; i++)
  made.push(makeInLoop());
show("loop size", new Set(made).size);
show("loop text", made.map(String).join());

const inBody = [];
for (let i = 0; i < 3; i++)
  inBody.push(Symbol("body"));
show("body size", new Set(inBody).size);

function makeTwiceByCondition(flag) { return flag ? Symbol("yes") : Symbol("no"); }
show("yes", makeTwiceByCondition(true));
show("no", makeTwiceByCondition(false));
show("yes again differs", makeTwiceByCondition(true) !== makeTwiceByCondition(true));

function recurse(depth) { return depth ? recurse(depth - 1) : Symbol("deep"); }
show("deep", recurse(3));
show("deep differs", recurse(2) !== recurse(2));

function makeFromCallback() { return Symbol("callback"); }
const mapped = [1, 2].map(makeFromCallback);
show("callback differs", mapped[0] !== mapped[1]);

const holder = {};
for (let i = 0; i < 2; i++) {
  Object.defineProperty(holder, "pet", { value: make(), writable: true, enumerable: true, configurable: true });
  show("defined again", holder.pet.description);
  show("defined is not the first", holder.pet !== first);
}
