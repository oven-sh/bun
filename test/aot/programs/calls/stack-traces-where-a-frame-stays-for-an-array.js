// A function gives up a tail call where its frame holds an array that the callee reads. A stack trace does not show it: the frame is left out as if the call had replaced it. The output is that of plain Bun.
const opaque = value => (globalThis.never ? null : value);
function names(error) {
  return error.stack.split("\n").map(line => line.trim().replace(/^at /, "").split(/[ @(]/)[0]).filter(name => /^(thrower|tail|tailRest|outer|readsThenThrows|passesOn)$/.test(name)).join(" < ");
}
function thrower(list) {
  if (list.length) throw new Error("thrown");
  return 0;
}
function tail(a) {
  return thrower([a, a]);
}
function readsThenThrows(a, b, ...rest) {
  if (rest.length + a + b) throw new Error("thrown");
  return 0;
}
function passesOn(...args) {
  return readsThenThrows(1, 2, ...args);
}
function outer(f, ...values) {
  try {
    return f(...values) + 0;
  } catch (error) {
    return names(error);
  }
}
for (let i = 0; i < 3; i++) console.log(outer(opaque(tail), i), "|", outer(opaque(passesOn), i, i), "|", outer(tail, i), "|", outer(passesOn, i));
