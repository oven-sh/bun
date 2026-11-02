// A function that awaits a call hands its caller's saved registers back when it leaves, also where another call was placed between the awaited call and the suspension.
// Alone: which defaults are moved out of line, and so which call is placed there, depends on what else the executable holds.
let ticks = 0;
function join(a, b) { ticks += a.length; return a + b; }
async function direct(x) { ticks++; await 0; return x + 1; }
async function moveOne({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(label, other);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  if (a) {
    const r = await direct(n);
    return [e ? "set" : "not set", r, text];
  }
  return [b, c, d, text];
}
async function moveAgainOne({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  if (a) {
    const r = await direct(n + 1);
    return [b ? "set" : "not set", r, text];
  }
  return [c, d, e, text];
}
async function callerOne({ a = false, b = false, c = false, d = false, e = false }, options, label, other) {
  let text = join(label, other);
  text = join(label, text);
  text = join(other, text);
  const one = moveOne(options, 1, label, other);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  const two = moveAgainOne(options, 2, text, text);
  return [a, b, c, d, e, text, await one, await two];
}
async function moveTwo({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  if (a) {
    const r = await direct(n);
    return [e ? "set" : "not set", r, text];
  }
  return [b, c, d, text];
}
async function moveAgainTwo({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  if (a) {
    const r = await direct(n + 1);
    return [b ? "set" : "not set", r, text];
  }
  return [c, d, e, text];
}
async function callerTwo({ a = false, b = false, c = false, d = false, e = false }, options, label, other) {
  let text = join(label, other);
  text = join(label, text);
  text = join(other, text);
  const one = moveTwo(options, 1, label, other);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  const two = moveAgainTwo(options, 2, text, text);
  return [a, b, c, d, e, text, await one, await two];
}
async function moveThree({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(label, other);
  text = join(label, text);
  text = join(label, text);
  text = join(other, text);
  text = join(other, text);
  if (a) {
    const r = await direct(n);
    return [e ? "set" : "not set", r, text];
  }
  return [b, c, d, text];
}
async function moveAgainThree({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(other, text);
  text = join(other, text);
  text = join(label, text);
  text = join(label, text);
  if (a) {
    const r = await direct(n + 1);
    return [b ? "set" : "not set", r, text];
  }
  return [c, d, e, text];
}
async function callerThree({ a = false, b = false, c = false, d = false, e = false }, options, label, other) {
  let text = join(label, other);
  text = join(other, text);
  text = join(label, text);
  const one = moveThree(options, 1, label, other);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  const two = moveAgainThree(options, 2, text, text);
  return [a, b, c, d, e, text, await one, await two];
}
async function moveFour({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  if (a) {
    const r = await direct(n);
    return [e ? "set" : "not set", r, text];
  }
  return [b, c, d, text];
}
async function moveAgainFour({ a = false, b = false, c = false, d = false, e = false }, n, label, other) {
  let text = join(other, label);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  if (a) {
    const r = await direct(n + 1);
    return [b ? "set" : "not set", r, text];
  }
  return [c, d, e, text];
}
async function callerFour({ a = false, b = false, c = false, d = false, e = false }, options, label, other) {
  let text = join(label, other);
  text = join(other, text);
  text = join(label, text);
  const one = moveFour(options, 1, label, other);
  text = join(other, text);
  text = join(label, text);
  text = join(other, text);
  text = join(label, text);
  const two = moveAgainFour(options, 2, text, text);
  return [a, b, c, d, e, text, await one, await two];
}
const data = JSON.parse('{"options":{"a":1,"d":true},"label":"main","other":"dev"}');
console.log(JSON.stringify(await callerOne(data.options, data.options, data.label, data.other)), ticks);
console.log(JSON.stringify(await callerTwo(data.options, data.options, data.label, data.other)), ticks);
console.log(JSON.stringify(await callerThree(data.options, data.options, data.label, data.other)), ticks);
console.log(JSON.stringify(await callerFour(data.options, data.options, data.label, data.other)), ticks);
