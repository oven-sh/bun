let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function strict() {
  Object.defineProperty(arguments, 1, descriptor);
  tick.apply(null, arguments);
}
const sloppy = new Function("tick", "descriptor", "return function (first, second) { Object.defineProperty(arguments, 1, descriptor); tick.apply(null, arguments); };")(tick, descriptor);
function withParameters(first, second) {
  Object.defineProperty(arguments, 0, descriptor);
  return Reflect.apply(tick, null, arguments);
}
for (let i = 0; i < 300; i++) strict(i, i, i);
console.log(calls, reads);
for (let i = 0; i < 300; i++) sloppy(i, i, i);
console.log(calls, reads);
for (let i = 0; i < 300; i++) withParameters(i, i);
console.log(calls, reads);
