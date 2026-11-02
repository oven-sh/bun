// A TypeError quotes the read, the store or the call that failed as it is written. None of these functions is ever used as a value: each is only called.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + error.message);
  }
}

function read(o) {
  return o.x;
}
function readDeep(o) {
  return o.p.q;
}
function readElement(o) {
  return o[0];
}
function readByComputedKey(o, i) {
  return o.list[i + 1];
}
function readOfThis() {
  return this.x;
}
function readOfResult(f) {
  return f().x;
}
function readBehindOptional(o) {
  return o?.a.b.c;
}
function store(o) {
  o.x = 1;
}
function update(o) {
  o.n++;
}
function add(o) {
  o.n += 2;
}
function remove(o) {
  delete o.x;
}
function has(o) {
  return "x" in o;
}
function callMember(o) {
  return o.run(1, "two");
}
function callDeep(o) {
  return o.a.b.run();
}
function callWhatIsNoFunction(o) {
  return o.run(1);
}
function construct(o) {
  return new o.K(1);
}
function inTemplate(o) {
  return `${o.t}`;
}
function spread(o) {
  return [...o.items];
}
// prettier-ignore
function overLines(o) {
  return o
    .first
    .second;
}
function behindOtherLines(o, n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += i;
  return total + o.inner.value;
}
function twoOnALine(a, b) {
  return a.x + b.x;
}
function twoCallsOnALine(a, b) {
  return a.run(1) + b.run(2);
}
function outer(o) {
  function inner(p) {
    return p.q;
  }
  return inner(o);
}
const arrow = o => o.x;
function* generator(o) {
  yield o.g;
}
async function asynchronous(o) {
  return o.h;
}
class Point {
  constructor(o) {
    this.x = o.x;
  }
  get width() {
    return this.inner.width;
  }
  method(o) {
    return o.y;
  }
  static make(o) {
    return o.z;
  }
  #hidden(o) {
    return o.w;
  }
  viaHidden(o) {
    return this.#hidden(o);
  }
}

tell("read of null", () => read(null));
tell("read of undefined", () => read(undefined));
tell("deep", () => readDeep({ p: null }));
tell("element", () => readElement(null));
tell("by computed key", () => readByComputedKey({}, 1));
tell("this", () => readOfThis.call(undefined));
tell("result", () => readOfResult(() => null));
tell("behind ?.", () => readBehindOptional({ a: {} }));
tell("store", () => store(null));
tell("update", () => update(null));
tell("add", () => add(null));
tell("delete", () => remove(null));
tell("in", () => has(null));
tell("call", () => callMember(null));
tell("deep call", () => callDeep({ a: {} }));
tell("no function", () => callWhatIsNoFunction({}));
tell("no constructor", () => construct({}));
tell("template", () => inTemplate(null));
tell("spread", () => spread(null));
tell("over lines", () => overLines({}));
tell("behind other lines", () => behindOtherLines({}, 3));
tell("two on a line, the first", () => twoOnALine(null, {}));
tell("two on a line, the second", () => twoOnALine({}, null));
tell("two calls on a line", () => twoCallsOnALine({ run() {} }, {}));
tell("inner function", () => outer(null));
tell("arrow", () => arrow(null));
tell("generator", () => generator(null).next());
tell("constructor", () => new Point(null));
tell("getter", () => new Point({}).width);
tell("method", () => new Point({}).method(null));
tell("static method", () => Point.make(null));
tell("private method", () => new Point({}).viaHidden(null));
await asynchronous(null).catch(error => console.log("async: " + error.message));
