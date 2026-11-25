// The call stands in the place of a tail call, under try, in finally, and one of the callees throws or calls back.
function up(x) { return x + 1; }
function down(x) { return x - 1; }
function fails(x) { throw new RangeError("fails at " + x); }
function returned(i) {
    const f = i & 1 ? up : down;
    return f(i);
}
function deep(i, left) {
    if (!left)
        return i;
    const next = left & 1 ? deep : shallow;
    return next(i + 1, left - 1);
}
function shallow(i, left) { return deep(i + 10, left); }
function guarded(i) {
    const f = i % 3 === 0 ? up : i % 3 === 1 ? fails : down;
    try {
        return f(i);
    } catch (error) {
        return error.message;
    } finally {
        const g = i & 1 ? up : down;
        seen.push(g(i));
    }
}
class Fails { constructor(x) { this.before = x; throw new TypeError("no object " + x); } }
class Works { constructor(x) { this.x = x; } }

const seen = [];
const log = [];
for (let i = 0; i < 7; i++) {
    log.push(returned(i), deep(i, 5), guarded(i));
    const C = i & 1 ? Fails : Works;
    try {
        log.push(new C(i).x);
    } catch (error) {
        log.push(error.message);
    }
}
console.log(log.join());
console.log(seen.join());
