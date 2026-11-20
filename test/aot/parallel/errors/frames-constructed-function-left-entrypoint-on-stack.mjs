// A function that is both called and constructed leaves by a tail call. Its result is known, so the code that enters it by value
// stays on the stack to return that result. The stack trace still lists `new one` below the callee.
const frames = error => error.stack.split("\n").slice(1, 5).map(line => line.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" < ");
const hide = value => [value][0];
function fail(value) { console.log(frames(new Error("x"))); }
function captures(value) { const holder = {}; Error.captureStackTrace(holder); console.log(frames(holder)); }
function faults(value) { try { null.x; } catch (error) { console.log(frames(error)); } }
function one(value) { return fail(value); }
function two(value) { return captures(value); }
function three(value) { return faults(value); }
function through(value) { return one(value); }
function answers(value) { return fail(value), 1; }
function inFunction(f) { const made = new f(0); f(0); return made; }
new one(0);
one(0);
new two(0);
two(0);
new three(0);
three(0);
new through(0);
through(0);
new answers(0);
answers(0);
for (const f of [one, two, three, through]) inFunction(hide(f));
Reflect.construct(one, [0]);
Reflect.construct(hide(one), [0], hide(two));
new (new Proxy(one, {}))(0);
new (one.bind(null))(0);
class Derived extends one {}
new Derived(0);
