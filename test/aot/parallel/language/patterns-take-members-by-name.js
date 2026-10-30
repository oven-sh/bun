// Patterns take members by name: in declarations, parameters, assignments and loops, with defaults, nested and with a rest.
async function pull(reader) {
  const { done, value } = await reader.read();
  return done ? 0 : value;
}
function defaults(options) {
  const { all = false, dot = false } = options;
  return all || dot;
}
function parameters({ a, b }) {
  return a + b;
}
function nested(o) {
  const {
    p: { q },
  } = o;
  return q;
}
function assigned(o) {
  let x, y;
  ({ x, y } = o);
  return x + y;
}
function rest(o) {
  const { a, ...others } = o;
  return a + Object.keys(others).length;
}
function loop(list) {
  let s = 0;
  for (const { v } of list) s += v;
  return s;
}
console.log(
  defaults({ all: true }),
  parameters({ a: 1, b: 2 }),
  nested({ p: { q: 3 } }),
  assigned({ x: 1, y: 2 }),
  rest({ a: 1, b: 2 }),
  loop([{ v: 1 }, { v: 2 }]),
);
pull({ read: async () => ({ done: false, value: 5 }) }).then(console.log);
