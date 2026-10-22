// Object.assign stores undefined and null over numbers and booleans that a constructor has filled; typed code that reads them afterwards sees what plain Bun sees. Each copy repeats, so that every way of a plan is taken.
const unseen: any = JSON.parse('{"nothing":null,"seven":7,"half":0.5,"yes":true,"text":"t"}');

class Limiter {
  max = 10;
  windowMs = 1000.5;
  strict = false;
  label = "none";
  constructor(options: object) {
    Object.assign(this, options);
  }
}
function read(limiter: Limiter): string {
  const sum = limiter.max + limiter.windowMs;
  return [limiter.max, limiter.windowMs, limiter.strict, typeof limiter.max, typeof limiter.windowMs, typeof limiter.strict, sum, limiter.max === undefined, limiter.windowMs === null, limiter.strict ? "on" : "off", limiter.max > 5, JSON.stringify(limiter)].join(" ");
}
class Counter {
  count = 0;
  step = 1;
  done = false;
}
function readCounter(counter: Counter): string {
  return [counter.count, counter.step, counter.done, counter.count + counter.step, typeof counter.count, !counter.done].join(" ");
}
type Options = { max?: number | null; windowMs?: number | null; strict?: boolean | null };
function optionsFor(turn: number): Options {
  switch (turn % 6) {
    case 0:
      return { max: turn, windowMs: turn + 0.25, strict: true };
    case 1:
      return { max: undefined, windowMs: turn, strict: false };
    case 2:
      return { max: turn, windowMs: null, strict: undefined };
    case 3:
      return { max: null, windowMs: undefined, strict: null };
    case 4:
      return { max: unseen.missing, windowMs: unseen.half, strict: unseen.nothing };
    default:
      return { max: unseen.seven, windowMs: unseen.nothing, strict: unseen.yes };
  }
}

const lines: string[] = [];
for (let turn = 0; turn < 36; turn++) {
  // Out of a record.
  lines.push(read(new Limiter(optionsFor(turn))));
  // Out of an ordinary object.
  lines.push(read(new Limiter(JSON.parse(turn % 3 === 0 ? '{"max":null,"strict":true}' : turn % 3 === 1 ? '{"max":3,"strict":null,"windowMs":2}' : '{"max":4,"strict":false,"windowMs":1.5}'))));
  // Out of an object of the same class, whose slots hold the markers themselves.
  const source = new Limiter(optionsFor(turn + 1));
  const target = new Limiter({});
  lines.push(read(Object.assign(target, source)));
  // A number over a marker, and a marker over that.
  lines.push(read(Object.assign(target, { max: turn, windowMs: turn, strict: true })));
  lines.push(read(Object.assign(target, optionsFor(turn + 3))));
  // A value that no slot of the kind takes, among markers.
  lines.push(read(Object.assign(new Limiter({}), { max: turn % 2 ? unseen.text : undefined, windowMs: null, strict: turn % 2 ? 1 : null })));
  const counter = new Counter();
  lines.push(readCounter(Object.assign(counter, { count: turn % 4 === 3 ? unseen.nothing : turn, done: turn % 5 === 4 ? undefined : turn > 10 })));
  lines.push(readCounter(Object.assign(counter, { count: counter.count + counter.step })));
}
console.log(lines.join("\n"));
