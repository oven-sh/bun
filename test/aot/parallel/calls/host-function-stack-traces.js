// Stack traces across native frames: errors created in callbacks that native functions call with 0 to 5 arguments, and errors that native functions and constructors throw, list the frames that plain Bun lists.

// A built-in written in JavaScript may be expanded where it is called, so a callback of one asks for the program's frames only.
function frames(error, includesNativeFrames) {
  const list = [];
  for (const line of String(error.stack).split("\n")) {
    const frame = /^\s*at (?:new )?(.*?) \((.*)\)$/.exec(line) ?? /^(.*?)@(.*)$/.exec(line);
    if (!frame) continue;
    const [, name, location] = frame;
    const isNative = location === "[native code]" || location.startsWith("native");
    if (!isNative) list.push(name + ":" + (/:(\d+):\d+$/.exec(location)?.[1] ?? location));
    else if (includesNativeFrames) list.push(name + " (native)");
    if (name === "root") break;
  }
  return list.join(" < ");
}

let traces = new Set();
function capture(includesNativeFrames = true) {
  traces.add(frames(new Error("captured"), includesNativeFrames));
}

// No call below is in tail position: a tail call would drop the frame of its caller. Each result is used twice, because plain Bun's transpiler
// puts a constant that is used once in the place of its use, and `return callee()` is a tail call.
let lastResult;
function root(caller, subject, values) {
  const result = caller(subject, ...values);
  lastResult = result;
  return result;
}

function call0(callee) { const result = callee(); lastResult = result; return result; }
function call1(callee, a) { const result = callee(a); lastResult = result; return result; }
function call2(callee, a, b) { const result = callee(a, b); lastResult = result; return result; }
function call3(callee, a, b, c) { const result = callee(a, b, c); lastResult = result; return result; }
function call4(callee, a, b, c, d) { const result = callee(a, b, c, d); lastResult = result; return result; }
function call5(callee, a, b, c, d, e) { const result = callee(a, b, c, d, e); lastResult = result; return result; }
const calls = [call0, call1, call2, call3, call4, call5];

function invoke0(receiver) { const result = receiver.toLocaleString(); lastResult = result; return result; }
function invoke1(receiver, a) { const result = receiver.toLocaleString(a); lastResult = result; return result; }
function invoke2(receiver, a, b) { const result = receiver.toLocaleString(a, b); lastResult = result; return result; }
function invoke3(receiver, a, b, c) { const result = receiver.toLocaleString(a, b, c); lastResult = result; return result; }
function invoke4(receiver, a, b, c, d) { const result = receiver.toLocaleString(a, b, c, d); lastResult = result; return result; }
function invoke5(receiver, a, b, c, d, e) { const result = receiver.toLocaleString(a, b, c, d, e); lastResult = result; return result; }
const invokes = [invoke0, invoke1, invoke2, invoke3, invoke4, invoke5];

function construct0(callee) { const result = new callee(); return result; }
function construct1(callee, a) { const result = new callee(a); return result; }
function construct2(callee, a, b) { const result = new callee(a, b); return result; }
function construct3(callee, a, b, c) { const result = new callee(a, b, c); return result; }
function construct4(callee, a, b, c, d) { const result = new callee(a, b, c, d); return result; }
function construct5(callee, a, b, c, d, e) { const result = new callee(a, b, c, d, e); return result; }
const constructs = [construct0, construct1, construct2, construct3, construct4, construct5];

function summarize(value) {
  if (value instanceof Map) return `${value.constructor.name}(${value.size})`;
  return JSON.stringify(value);
}

function attempt(caller, subject, values) {
  const liveAcrossCall = values.length * 7 + 1;
  try {
    return `${summarize(root(caller, subject, values))} ${liveAcrossCall}`;
  } catch (error) {
    return `${error.name}: ${error.message} [${frames(error, true)}] ${liveAcrossCall}`;
  }
}

// Every round must give the outcome and the traces of the first, whichever caches have been filled since.
function show(label, caller, subject, values) {
  traces = new Set();
  const outcomes = new Set();
  for (let round = 0; round < 20; round++) outcomes.add(attempt(caller, subject, values));
  console.log(`${label}: ${[...outcomes].join(" || ")} | ${[...traces].join(" || ")}`);
}

const natives = { fromCharCode: String.fromCharCode, parse: JSON.parse, construct: Reflect.construct, Map };

function createCodeUnit(character) {
  const unit = character.charCodeAt(0);
  return {
    valueOf() {
      capture();
      return unit;
    },
  };
}
const codeUnits = ["a", "b", "c", "d", "e"].map(createCodeUnit);
for (let count = 0; count <= 5; count++) show(`fromCharCode, ${count} arguments`, calls[count], natives.fromCharCode, codeUnits.slice(0, count));

const receiver = {
  toString() {
    capture();
    return "receiver";
  },
};
for (let count = 0; count <= 5; count++) show(`toLocaleString, ${count} arguments`, invokes[count], receiver, [1, 2, 3, 4, 5].slice(0, count));

function revive(key, value) {
  capture();
  return value;
}
for (let count = 0; count <= 5; count++) show(`JSON.parse, ${count} arguments`, calls[count], natives.parse, ["[1]", revive, 3, 4, 5].slice(0, count));

const entries = {
  [Symbol.iterator]: function iterate() {
    capture();
    const iterator = [["key", 1]][Symbol.iterator]();
    return iterator;
  },
};
for (let count = 0; count <= 5; count++) show(`new Map, ${count} arguments`, constructs[count], natives.Map, [entries, 2, 3, 4, 5].slice(0, count));

class Recording extends Map {
  constructor(count, iterable) {
    switch (count) {
      case 0:
        super();
        break;
      case 1:
        super(iterable);
        break;
      case 2:
        super(iterable, 2);
        break;
      case 3:
        super(iterable, 2, 3);
        break;
      case 4:
        super(iterable, 2, 3, 4);
        break;
      default:
        super(iterable, 2, 3, 4, 5);
    }
  }
  set(key, value) {
    capture();
    super.set(key, value);
    return this;
  }
}
function constructRecording(count, iterable) {
  const result = new Recording(count, iterable);
  return result;
}
for (let count = 0; count <= 5; count++) show(`super, ${count} arguments`, constructRecording, count, [[["key", count]]]);
show("Reflect.construct under a subclass", call3, natives.construct, [Map, [[["key", 1]]], Recording]);

function visit(value) {
  capture(false);
  return value + 1;
}
function mapLiteral() {
  const result = [1].map(visit);
  lastResult = result;
  return result;
}
function mapReceiver(array, callback) {
  const result = array.map(callback);
  lastResult = result;
  return result;
}
function parseWithReviver() {
  const result = JSON.parse("[1]", revive);
  lastResult = result;
  return result;
}
// Called by value: bytecode constructs in place of the written call `Reflect.construct(f, list)`, without a frame of `construct`, and compiled code calls the function.
function constructUnderSubclass() {
  const construct = natives.construct;
  const result = construct(Map, [[["key", 1]]], Recording);
  lastResult = result;
  return result;
}
show("[1].map", mapLiteral, undefined, []);
show("map of a parameter", mapReceiver, [1], [visit]);
show("JSON.parse with a reviver", parseWithReviver, undefined, []);
show("Reflect.construct(Map, [entries], Recording)", constructUnderSubclass, undefined, []);

function constructMapOfNumber() {
  const result = new Map(1);
  return result;
}
function catchInCaller(callee, value) {
  const liveAcrossCall = value + 41;
  try {
    new callee(value);
    return "no error";
  } catch (error) {
    return `${error.name} [${frames(error, true)}] ${liveAcrossCall}`;
  }
}
for (let count = 1; count <= 5; count++) show(`new Map of a number, ${count} arguments`, constructs[count], natives.Map, [1, 2, 3, 4, 5].slice(0, count));
for (let count = 1; count <= 5; count++) show(`super of a number, ${count} arguments`, constructRecording, count, [1]);
show("Reflect.construct of a number", call3, natives.construct, [Map, [1], Recording]);
show("new Map(1)", constructMapOfNumber, undefined, []);
show("new Map(1) caught by its caller", catchInCaller, natives.Map, [1]);
