// STATISTIC: StepsOfIterationHeldBelowRoom >= 8
// STATISTIC: SecondCountersOfMultiplesGuarded >= 1
// Loops that step their counter several times in one iteration, with second counters beside it: inside their views, at their ends and past them.
function channels(target, source) {
  var from = 0;
  for (var at = 0; at < 60;) {
    target[at++] = (source[from] >> 16) & 0xff;
    target[at++] = (source[from] >> 8) & 0xff;
    target[at++] = source[from++] & 0xff;
  }
  return at + from;
}
function widen(target, source, count) {
  var from = 0;
  for (var at = 0; at < count; ++at) {
    target[at++] = source[from++];
    target[at++] = source[from++];
    target[at++] = source[from++];
  }
  return at + from;
}
function widenByStep(target, source) {
  for (var at = 0, from = 0; at < target.length; at += 4, from += 3) {
    target[at] = source[from];
    target[at + 1] = source[from + 1];
    target[at + 2] = source[from + 2];
    target[at + 3] = 255;
  }
  return at + from;
}
function interleave(target, source) {
  var to = 0;
  for (var at = 0; at < source.length; at++) {
    target[to++] = source[at];
    target[to++] = -source[at];
  }
  return at + to;
}
function scale(target, source) {
  for (var at = 0; at < target.length;) {
    target[at] = source[at++] * 2;
    target[at] = source[at++] * 3;
    target[at] = source[at++] * 4;
  }
  return at;
}
function sumBytes(view) {
  let hash = 0;
  for (let at = 0; at < view.length; at++) hash = (hash * 31 + view[at]) | 0;
  return hash;
}
function sumSingles(view) {
  let hash = 0;
  for (let at = 0; at < view.length; at++) hash = (hash * 31 + view[at] * 8) | 0;
  return hash;
}
function bytes(length) {
  const view = new Uint8Array(length);
  for (let at = 0; at < length; at++) view[at] = at * 37 + 11;
  return view;
}
function words(length) {
  const view = new Int32Array(length);
  for (let at = 0; at < length; at++) view[at] = at * 0x10203 + 77;
  return view;
}
function singles(length) {
  const view = new Float32Array(length);
  for (let at = 0; at < length; at++) view[at] = at * 0.5 + 1;
  return view;
}
const lengths = [[60, 20], [60, 19], [59, 20], [58, 64], [0, 0], [61, 21], [64, 48], [64, 47], [64, 46], [8, 60], [63, 60], [60, 45], [60, 44], [60, 30], [60, 31]];
for (const [length, room] of lengths) {
  const target = new Uint8Array(length);
  console.log(length, room, channels(target, words(room)), sumBytes(target));
}
for (const [length, room] of lengths) {
  const target = new Uint8Array(length);
  console.log(widen(target, bytes(room), length), sumBytes(target), widen(target, bytes(room), length - 1), sumBytes(target));
}
for (const [length, room] of lengths) {
  const target = new Uint8Array(length);
  console.log(widenByStep(target, bytes(room)), sumBytes(target));
}
for (const [length, room] of lengths) {
  const target = new Float32Array(length);
  console.log(interleave(target, singles(room)), sumSingles(target), scale(target, singles(room)), sumSingles(target));
}
const shared = new Uint8Array(64);
for (let at = 0; at < 64; at++) shared[at] = at;
console.log(widen(shared, new Uint8Array(shared.buffer, 4), 60), sumBytes(shared), widenByStep(shared, new Uint8Array(shared.buffer, 1, 48)), sumBytes(shared));
