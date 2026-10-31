// Construction makes no tail calls: a function with a self tail call keeps its frame below the call when it is constructed, and drops it when it is called.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 6)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(.*[\\/]/, "(")
        .replace(/^[^ ]*[\\/]/, ""),
    )
    .join(" < ");
function countDown(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return countDown(steps - 1);
}
function fills(steps) {
  if (this) this.steps = steps;
  if (steps <= 0) throw new URIError("at the end");
  return fills(steps - 1);
}
function readsNewTarget(steps) {
  if (steps <= 0) throw new URIError(String(new.target === undefined));
  return readsNewTarget(steps - 1);
}
function takesRest(steps, ...rest) {
  if (steps <= 0) throw new URIError(String(rest.length));
  return takesRest(steps - 1, ...rest, steps);
}
function readsArguments(steps) {
  if (steps <= 0) throw new URIError(String(arguments.length));
  return readsArguments(steps - 1, steps);
}
function makeCounter(label) {
  return function counter(steps) {
    if (steps <= 0) throw new URIError(label);
    return counter(steps - 1);
  };
}
function catches(steps) {
  try {
    if (steps < 0) throw 1;
  } catch {}
  if (steps <= 0) throw new URIError("at the end");
  return catches(steps - 1);
}
function returnsObject(steps) {
  if (steps <= 0) return { frames: frames(new Error()) };
  return returnsObject(steps - 1);
}
function returnsNumber(steps) {
  this.seen = frames(new Error());
  if (steps <= 0) return 7;
  return returnsNumber.call(this, steps - 1);
}
function throughCall(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return throughCall.call(undefined, steps - 1);
}
function throughApply(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return throughApply.apply(undefined, [steps - 1]);
}
const ownNameThroughCall = function inner(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return inner.call(undefined, steps - 1);
};
const ownNameThroughApply = function inner(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return inner.apply(undefined, [steps - 1]);
};
function Parent(steps) {
  if (steps <= 0) throw new URIError("at the end");
  return Parent(steps - 1);
}
class Child extends Parent {
  constructor(steps) {
    super(steps);
  }
}
const handedBack = value => [value][0];
const callees = {
  countDown,
  fills,
  readsNewTarget,
  takesRest,
  readsArguments,
  counter: makeCounter("a"),
  other: makeCounter("b"),
  catches,
  throughCall,
  throughApply,
  ownNameThroughCall,
  ownNameThroughApply,
  Parent,
};
const ways = {
  call: (callee, steps) => [callee(steps)],
  new: (callee, steps) => [new callee(steps)],
  "Reflect.construct": (callee, steps) => [Reflect.construct(callee, [steps])],
  "other new.target": (callee, steps) => [Reflect.construct(callee, [steps], Object)],
  bound: (callee, steps) => [new (callee.bind(null))(steps)],
  "bound argument": (callee, steps) => [new (callee.bind(null, steps))()],
  proxy: (callee, steps) => [new new Proxy(callee, {})(steps)],
  "handed back": (callee, steps) => [new (handedBack(callee))(steps)],
};
for (const name in callees) {
  for (const way in ways) {
    for (const steps of [0, 1, 2, 3]) {
      try {
        console.log(name, way, steps, ways[way](callees[name], steps));
      } catch (error) {
        console.log(name + " | " + way + " | " + steps + " | " + error.message + " | " + frames(error));
      }
    }
  }
}
for (const steps of [0, 1, 2, 3]) {
  for (const run of [
    () => new countDown(steps),
    () => new fills(steps),
    () => new readsNewTarget(steps),
    () => new Child(steps),
    () => new Parent(steps),
    () => new catches(steps),
  ]) {
    try {
      console.log(run());
    } catch (error) {
      console.log("direct | " + steps + " | " + error.message + " | " + frames(error));
    }
  }
  console.log("object | " + steps + " | " + new returnsObject(steps).frames + " | " + returnsObject(steps).frames);
  console.log("number | " + steps + " | " + new returnsNumber(steps).seen);
}
// Often enough that the call sites are warm.
let last = "";
for (let round = 0; round < handedBack(300); ++round) {
  try {
    new countDown(round % 3);
  } catch (error) {
    last = frames(error);
  }
  try {
    new (handedBack(countDown))(round % 3);
  } catch (error) {
    last += " || " + frames(error);
  }
}
console.log(last);
