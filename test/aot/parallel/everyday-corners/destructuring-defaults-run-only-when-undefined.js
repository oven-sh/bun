// Destructuring defaults run only when undefined: compiled answers as plain.
const log = [];
const d = n => (log.push(n), n);
const { a = d("a"), b = d("b"), c = d("c") } = { a: null, b: undefined, c: 0 };
const [x = d("x"), y = d("y")] = [undefined, false];
console.log(a, b, c, x, y, log.join());
