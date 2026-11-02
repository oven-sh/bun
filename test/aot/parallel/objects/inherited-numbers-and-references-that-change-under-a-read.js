// A read by name remembers the word of a value on a prototype. Each change here must reach it.
const hide = Function("value", "return value");
function up(heir) {
  return heir.up;
}
function call(heir) {
  return heir.m(1);
}
function run(heir, n) {
  let last;
  for (let i = 0; i < n; i++) last = up(heir);
  return last;
}
function runCall(heir, n) {
  let last;
  for (let i = 0; i < n; i++) last = call(heir);
  return last;
}
const show = value => (typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : String(value));

const shared = hide({ up: 1, m: a => a + 1 });
const heir = Object.create(shared);
console.log(show(run(heir, 3000)), show(runCall(heir, 3000)));
shared.up = 2;
console.log(show(run(heir, 10)));
shared.up = -2147483648;
console.log(show(run(heir, 10)));
shared.up = 2147483648;
console.log(show(run(heir, 10)));
shared.up = 1.5;
console.log(show(run(heir, 10)));
shared.up = "text";
console.log(show(run(heir, 10)));
shared.up = undefined;
console.log(show(run(heir, 10)));
shared.up = null;
console.log(show(run(heir, 10)));
shared.up = -0;
console.log(show(run(heir, 10)));
shared.up = 7;
console.log(show(run(heir, 10)));
shared.m = a => a + 2;
console.log(show(runCall(heir, 10)));
shared.m = 5;
try {
  runCall(heir, 1);
} catch (error) {
  console.log(error.name);
}
console.log(show(shared.m));
shared.m = function (a) {
  return this === heir ? a + 3 : -1;
};
console.log(show(runCall(heir, 10)));

heir.up = 100;
console.log(show(run(heir, 10)));
delete heir.up;
console.log(show(run(heir, 10)));
Object.defineProperty(shared, "up", { get: () => 55, configurable: true });
console.log(show(run(heir, 10)));
Object.defineProperty(shared, "up", { value: 56, writable: true, configurable: true });
console.log(show(run(heir, 10)));
delete shared.up;
console.log(show(run(heir, 10)));
shared.up = 57;
console.log(show(run(heir, 10)));
shared.grown1 = 1;
shared.grown2 = 2;
shared.up = 58;
console.log(show(run(heir, 10)));
Object.setPrototypeOf(heir, { up: 200, m: a => a + 9 });
console.log(show(run(heir, 10)), show(runCall(heir, 10)));
Object.setPrototypeOf(heir, null);
console.log(show(run(heir, 10)));
Object.setPrototypeOf(heir, shared);
console.log(show(run(heir, 10)));
Object.freeze(shared);
console.log(show(run(heir, 10)));

const a = Object.create(hide({ up: 11, other: 1 }));
const b = Object.create(hide({ other: 2, up: 12 }));
const c = Object.create(hide({ up: "s" }));
const d = Object.create(Object.create(hide({ up: 13 })));
let sum = 0;
for (let i = 0; i < 4000; i++) {
  sum += up(a) + up(b) + up(d);
  if (up(c) !== "s") sum = -1;
}
console.log(sum);
