// `const d = o === undefined ? {} : o` leaves o as it was.
function f(o) { const d = o === undefined ? {} : o; return o == null; }
console.log(f({}), f(undefined));
