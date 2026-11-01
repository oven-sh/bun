// Whoever makes a generator fills its frame, and whoever takes its first step enters the function that resumes it: there is no other function.
function* gen(a, b) { const c = a + b; yield c; yield c * 2; return "end"; }
function byHand(n) { const it = gen(n, 1); const x = it.next(); return [x.value, it.next().value, it.next().value, it.next().done]; }
function kept(n) { return gen(n, 2); }
const held = [kept(1), kept(process.argv.length)];
console.log(byHand(3), byHand(process.argv.length), held.map(g => [...g]));
// It ends, throws or is left before it has yielded.
function* endsAtOnce(n) { if (n > 1) return "early"; yield n; }
function* throwsAtOnce(n) { if (n > 1) throw new Error("at once " + n); yield n; }
function first(g) { try { return g.next(); } catch (e) { return e.message; } }
console.log(first(endsAtOnce(2)), first(endsAtOnce(1)), first(throwsAtOnce(process.argv.length)), first(throwsAtOnce(1)));
{ const g = throwsAtOnce(5); console.log(first(g), first(g), g.return(3)); }
{ const g = gen(1, 1); console.log(g.return("left"), g.next()); }
{ const g = gen(1, 1); try { g.throw(new Error("thrown in")); } catch (e) { console.log(e.message, g.next()); } }
// this, arguments, defaults, rest, captured variables and the function itself reach the first step.
const holder = { base: 10, *own(x) { yield this.base + x; yield arguments.length; } };
console.log([...holder.own(1, 2, 3)]);
function* withDefaults(a, b = a + 1, ...rest) { yield [a, b, rest]; yield withDefaults.name; }
console.log([...withDefaults(1)], [...withDefaults(1, 5, 6, 7)]);
function maker(k) { return function* () { yield k; k++; yield k; }; }
console.log([...maker(process.argv.length)()], [...maker("s")()]);
// A generator that makes itself again, and a tree walked with many that end at once.
function* down(n) { if (n > 0) { yield n; yield* down(n - 1); } }
console.log([...down(4)]);
function* walk(node) { if (!node) return; yield* walk(node.left); yield node.value; yield* walk(node.right); }
const tree = { value: 2, left: { value: 1 }, right: { value: 3, right: { value: 4 } } };
console.log([...walk(tree)]);
// Where the stack names the generator once.
function* traced() { yield new Error("t").stack.split("\n").filter(line => line.includes("traced")).length; }
console.log(traced().next().value, [...traced()]);
// The first step under a handler, and in a loop that may come back to it.
function guarded(n) { const g = throwsAtOnce(n); try { return g.next().value; } catch (e) { return [e.message, g.next().done]; } }
console.log(guarded(1), guarded(process.argv.length));
function drained(n) { const g = gen(n, n); const out = []; for (let s = g.next(); !s.done; s = g.next()) out.push(s.value); return out; }
console.log(drained(2), drained(process.argv.length));
