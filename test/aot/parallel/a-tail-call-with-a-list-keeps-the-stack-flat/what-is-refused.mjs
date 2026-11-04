const said = [];
function note(deed) {
  try { said.push(String(deed())); } catch (error) { said.push(error.constructor.name + ": " + error.message); }
}
function count() { return arguments.length; }
const nothing = (0, eval)("(x) => x")(undefined);
const number = (0, eval)("(x) => x")(5);
const fake = Object.create(Function.prototype);
let reads = 0;
function withGetter() {
  const list = [1, 2, 3];
  Object.defineProperty(list, 1, { get() { reads++; return 2; } });
  return list;
}
function tail(callee, list) { return callee.apply(null, list); }
function inside(callee, list) { const result = callee.apply(null, list); return result; }
note(() => tail(count, [1, , 3]));
note(() => inside(count, [1, , 3]));
note(() => tail(count, new Array(65536)));
note(() => inside(count, new Array(65536)));
note(() => tail(count, new Array(65537)).constructor.name);
note(() => inside(count, new Array(65537)).constructor.name);
note(() => tail(count, new Array(4000000)).constructor.name);
note(() => inside(count, new Array(4000000)).constructor.name);
note(() => Function.prototype.apply.call(number, null, [1, , 3]));
note(() => Reflect.apply(number, null, [1, , 3]));
note(() => tail(fake, [1, , 3]));
note(() => inside(fake, [1, , 3]));
note(() => tail(Math.max, [1, , 3]));
note(() => inside(Math.max, [1, 7, 3]));
note(() => tail(Math.max, withGetter()));
note(() => tail(count.bind(null, 0), [1, , 3]));
note(() => tail(count, nothing));
for (const line of said) console.log(line);
console.log(reads);
