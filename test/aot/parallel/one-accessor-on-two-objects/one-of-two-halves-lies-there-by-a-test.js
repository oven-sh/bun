// Which of two functions a written descriptor lays as the setter hangs on a test; each lays a name of its own.
function plain(next) { this.seen = next; }
function other(next) { this.other = next; }
const first = { raw: 0 }, second = { low: 0, more: 1 };
Object.defineProperty(first, "value", { set: process.argv.length > 99 ? plain : other });
Object.defineProperty(second, "value", { set: process.argv.length > 99 ? other : plain });
function touch(held, next) { held.value = next; return typeof held.seen + typeof held.other; }
console.log(touch(first, 5), touch(second, 6));
