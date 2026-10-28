// Reads NaNs out of float views and a DataView, changes their sign in loops, closures, calls and behind tests, hands each on as a value and prints its bytes.
const hex = value =>
  Array.from(new Uint8Array(new Float64Array([value]).buffer), byte => byte.toString(16).padStart(2, "0")).join("");
const doubles = new Float64Array(
  new BigUint64Array([0x7ff8000000001234n, 0xfff8000000005678n, 0x7ff0000000000001n, 0xffffffffffffffffn]).buffer,
);
const floats = new Float32Array(new Uint32Array([0x7fc01234, 0xffc05678, 0x7f800001, 0xffffffff]).buffer);
const bytes = new DataView(doubles.buffer);
const negate = value => -value;

function inALoop(view) {
  const out = [];
  for (let at = 0; at < view.length; at++) out.push(hex(-view[at]));
  return out.join(" ");
}
function once(view, at) {
  return hex(-view[at]);
}
function throughACall(view, at) {
  return hex(negate(view[at]));
}
function askedWhetherItIsThere(view, at) {
  const value = view[at];
  return value === undefined ? "outside" : hex(-value);
}
function byATest(view, at, flips) {
  return hex(flips ? -view[at] : view[at]);
}

for (const view of [doubles, floats]) {
  const name = view.constructor.name;
  console.log(name, "in a loop", inALoop(view));
  for (let at = 0; at < 5; at++) {
    console.log(
      name,
      at,
      once(view, at),
      throughACall(view, at),
      askedWhetherItIsThere(view, at),
      byATest(view, at, true),
      byATest(view, at, false),
    );
  }
}

const made = {};
for (let at = 0; at < 4; at++) {
  made["double " + at] = () => doubles[at];
  made["-double " + at] = () => -doubles[at];
  made["double + 1 " + at] = () => doubles[at] + 1;
  made["-(-double) " + at] = () => -(-doubles[at]);
  made["-(-double * 2) " + at] = () => -(-doubles[at] * 2);
  made["abs " + at] = () => Math.abs(doubles[at]);
  made["-abs " + at] = () => -Math.abs(doubles[at]);
  made["-float " + at] = () => -floats[at];
  made["-fround " + at] = () => -Math.fround(doubles[at]);
  made["-getFloat64 " + at] = () => -bytes.getFloat64(at * 8, true);
  made["-abs of getFloat32 " + at] = () => -Math.abs(bytes.getFloat32(at * 8 + 4, true));
}
for (const [name, make] of Object.entries(made)) console.log(name, hex(make()));

const few = [0, 1].map(at => [() => doubles[at], () => -doubles[at], () => doubles[at] + 1]).flat();
for (const make of few) console.log("one of few", hex(make()));
