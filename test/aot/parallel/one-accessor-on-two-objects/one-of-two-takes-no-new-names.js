// The setter lays a name that the literal does not list, and one of the two objects takes no new names: there the store throws.
function make(raw) { return { raw, set value(next) { this.seen = next; } }; }
function touch(held, next) { try { held.value = next; return typeof held.seen; } catch (error) { return error.constructor.name; } }
const open = make(1), shut = Object.preventExtensions(make(2));
console.log(touch(open, 5), touch(shut, 6), typeof open.seen, typeof shut.seen);
