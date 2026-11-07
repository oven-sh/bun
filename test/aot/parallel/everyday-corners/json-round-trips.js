// Json round trips: compiled answers as plain.
console.log(
  JSON.stringify(JSON.parse('{"__proto__":1,"a":[1,{"b":null}],"a2":1e2,"dup":1,"dup":2}')),
  JSON.parse("1"),
  JSON.parse('"\\u0041"'),
  (() => {
    try {
      JSON.parse("{a:1}");
    } catch (e) {
      return e.constructor.name;
    }
  })(),
  JSON.stringify(JSON.parse("[1,2]", (k, v) => (Array.isArray(v) ? v : v * 2))),
  JSON.stringify({ a: [undefined, () => 1], b: undefined, c: Symbol() }),
  Object.getPrototypeOf(JSON.parse('{"__proto__":null}')) === Object.prototype,
);
