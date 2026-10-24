// Array.from, Array.of and the methods that ask Symbol.species build their result with a constructor of the program,
// and then define elements and store `length` on whatever it returned.
class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
    this.length = 5;
  }
}
function sum(point) {
  return point.x + point.y + point.length;
}
function show(label, object, result) {
  console.log(label, result === object, Object.keys(object).join(), sum(object), object.length, object[0], object[1]);
}

{
  const victim = new Point();
  console.log(sum(victim));
  show(
    "from",
    victim,
    Array.from.call(
      function () {
        return victim;
      },
      [7, 8],
    ),
  );
}
{
  const victim = new Point();
  show(
    "from array-like",
    victim,
    Array.from.call(
      function () {
        return victim;
      },
      { length: 1, 0: "a" },
      value => value + "!",
    ),
  );
}
{
  const victim = new Point();
  show(
    "of",
    victim,
    Array.of.call(
      function () {
        return victim;
      },
      3,
      4,
      5,
    ),
  );
}
for (const method of ["map", "filter", "slice", "splice", "concat", "flat", "flatMap"]) {
  const victim = new Point();
  class Sneaky extends Array {
    static get [Symbol.species]() {
      return function () {
        return victim;
      };
    }
  }
  const list = new Sneaky();
  list.push(10, 20, 30);
  let result;
  switch (method) {
    case "map":
      result = list.map(value => value * 2);
      break;
    case "filter":
      result = list.filter(value => value > 10);
      break;
    case "slice":
      result = list.slice(1);
      break;
    case "splice":
      result = list.splice(0, 2);
      break;
    case "concat":
      result = list.concat([1]);
      break;
    case "flat":
      result = list.flat();
      break;
    case "flatMap":
      result = list.flatMap(value => [value, value]);
      break;
  }
  show(method, victim, result);
}
{
  const literal = { length: 5, kept: "kept" };
  const result = Array.from.call(function () {
    return literal;
  }, "ab");
  console.log(
    "literal",
    result === literal,
    literal.length,
    literal.kept,
    literal[0],
    literal[1],
    JSON.stringify(literal),
  );
}
{
  const frozen = Object.freeze({ length: 5 });
  try {
    Array.from.call(
      function () {
        return frozen;
      },
      [1],
    );
    console.log("no error");
  } catch (error) {
    console.log("frozen", error instanceof TypeError, frozen.length);
  }
}
