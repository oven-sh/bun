// Stack positions of operators beside parentheses and literals.
const sign = Symbol("sign");
const list = [1, 2, 3];
const point = { x: 1, y: 2 };
const text = Date.now() > 0 ? "text" : "";
const converts = {
  valueOf() {
    throw new RangeError("converted");
  },
};
function same(value) {
  return value;
}
function show(label, run) {
  try {
    run(1);
    console.log(label, "no error");
  } catch (error) {
    const frames = String(error.stack)
      .split("\n")
      .filter(line => /\bat run\b/.test(line))
      .map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, error.constructor.name, frames.join(" "));
  }
}

show("parentheses on the left of a sum", function run(n) {
  let result = 0;
  result += (list[0] ^ converts) + point.x;
  return result;
});
show("parentheses on the left of an equality", function run(n) {
  let result = 0;
  result += (converts | n) == n;
  return result;
});
show("parentheses on the left of a comparison", function run(n) {
  let result = 0;
  result += (`${n}` | converts) <= point["y"];
  return result;
});
show("parentheses on the left of a quotient behind text", function run(n) {
  let result = 0;
  result += "s" + (list.length + converts) / n;
  return result;
});
show("parentheses in parentheses", function run(n) {
  return n != ((converts + point.x - same(n) - text) * +text) / 2.5;
});
show("parentheses twice at the start", function run(n) {
  return ((n + point.x) * n + converts) * n;
});
show("parentheses twice at the start, the inner ones throw", function run(n) {
  return ((n + converts) * n + point.x) * n;
});
show("parentheses at the start behind an operand", function run(n) {
  return point.x + ((n + n) * converts + n) * n;
});
for (const [label, run] of [
  [
    "text === product",
    function run(n) {
      return "s" === list[0] * sign;
    },
  ],
  [
    "text == product",
    function run(n) {
      return "s" == list[0] * sign;
    },
  ],
  [
    "text != product",
    function run(n) {
      return "s" != list[0] * sign;
    },
  ],
  [
    "text !== product",
    function run(n) {
      return "s" !== n * sign;
    },
  ],
  [
    "number === product",
    function run(n) {
      return 2.5 === n * sign;
    },
  ],
  [
    "null == product",
    function run(n) {
      return null == n * sign;
    },
  ],
  [
    "undefined === product",
    function run(n) {
      return undefined === n * sign;
    },
  ],
  [
    "true != product",
    function run(n) {
      return true != n * sign;
    },
  ],
  [
    "bigint == product",
    function run(n) {
      return 1n == n * sign;
    },
  ],
  [
    "computed number === product",
    function run(n) {
      return 1 + 2 === n * sign;
    },
  ],
  [
    "text < product",
    function run(n) {
      return "s" < list[0] * sign;
    },
  ],
  [
    "text + product",
    function run(n) {
      return "s" + list[0] * sign;
    },
  ],
  [
    "name === product",
    function run(n) {
      return n === list[0] * sign;
    },
  ],
  [
    "text === product in a chain",
    function run(n) {
      return (("s" === list[0] * sign) != -n) != 2.5;
    },
  ],
  [
    "text === text === product",
    function run(n) {
      return ("s" === "t") === n * sign;
    },
  ],
  [
    "a comma that does nothing",
    function run(n) {
      return (n, point.x) * sign;
    },
  ],
  [
    "a comma that does nothing in front of a number",
    function run(n) {
      return (n, 3) * sign;
    },
  ],
  [
    "a comma that calls",
    function run(n) {
      return (same(n), point.x) * sign;
    },
  ],
  [
    "a computed comparison behind a comma",
    function run(n) {
      return (n, 3) >= 1 <= converts;
    },
  ],
  [
    "a comparison of two types behind a comma",
    function run(n) {
      return ((((n, 3) !== 1) !== "s") === same(n)) != converts;
    },
  ],
  [
    "an element of a written list",
    function run(n) {
      return [n][0] * converts;
    },
  ],
  [
    "the second element of a written list",
    function run(n) {
      return [n, list][1] * converts;
    },
  ],
  [
    "an element of a written list that calls",
    function run(n) {
      return [same(n), n][1] * converts;
    },
  ],
  [
    "object == element of a written list",
    function run(n) {
      return converts == [n][0];
    },
  ],
  [
    "object == name",
    function run(n) {
      return converts == n;
    },
  ],
  [
    "name == object",
    function run(n) {
      return n == converts;
    },
  ],
  [
    "object == number",
    function run(n) {
      return converts == 1;
    },
  ],
  [
    "number == object",
    function run(n) {
      return 1 == converts;
    },
  ],
  [
    "object == sum",
    function run(n) {
      return converts == n + 1;
    },
  ],
  [
    "sum == object",
    function run(n) {
      return n + 1 == converts;
    },
  ],
  [
    "object == member",
    function run(n) {
      return converts == point.x;
    },
  ],
  [
    "member == object",
    function run(n) {
      return point.x == converts;
    },
  ],
  [
    "object == call",
    function run(n) {
      return converts == same(n);
    },
  ],
  [
    "call == object",
    function run(n) {
      return same(n) == converts;
    },
  ],
  [
    "object == element",
    function run(n) {
      return converts == list[n];
    },
  ],
  [
    "object == name as the last argument",
    function run(n) {
      return same(converts == n);
    },
  ],
  [
    "object == name as the first argument",
    function run(n) {
      return same(converts == n, n);
    },
  ],
  [
    "object == name as the last element",
    function run(n) {
      return [list, converts == n];
    },
  ],
  [
    "object == name as the first element",
    function run(n) {
      return [converts == n, list];
    },
  ],
  [
    "object == name in parentheses",
    function run(n) {
      return (converts == n) + n;
    },
  ],
  [
    "object == name == name",
    function run(n) {
      return (converts == n) == n;
    },
  ],
  [
    "object == number == number",
    function run(n) {
      return (converts == 1) == 2;
    },
  ],
  [
    "object == negated name",
    function run(n) {
      return converts == -n;
    },
  ],
  [
    "object == not name",
    function run(n) {
      return converts == !n;
    },
  ],
  [
    "object != name",
    function run(n) {
      return converts != n;
    },
  ],
  [
    "object == name in an if",
    function run(n) {
      if (converts == n) return 1;
    },
  ],
  [
    "name == object in an if",
    function run(n) {
      if (n == converts) return 1;
    },
  ],
  [
    "object == name in a condition",
    function run(n) {
      return converts == n ? 1 : 2;
    },
  ],
  [
    "object == number in a loop",
    function run(n) {
      while (converts == 1) n++;
    },
  ],
  [
    "object == name behind &&",
    function run(n) {
      if (point.x && converts == n) return 1;
    },
  ],
  [
    "product < number in an if",
    function run(n) {
      if (n * sign < 1) return 1;
    },
  ],
  [
    "object < number behind && in an if",
    function run(n) {
      if (point.x && converts < 1) return 1;
    },
  ],
  [
    "text != object in an if",
    function run(n) {
      if ("s" != converts) return 1;
    },
  ],
  [
    "sum in parentheses < object in an if",
    function run(n) {
      if ((n + n) * n < converts) return 1;
    },
  ],
  [
    "parentheses first behind a declaration",
    function run(n) {
      let i = (n + n) * converts;
      return i + i;
    },
  ],
  [
    "parentheses first behind an element",
    function run(n) {
      return [n, (n + n) * converts];
    },
  ],
  [
    "parentheses first in a list",
    function run(n) {
      return [(n + n) * converts];
    },
  ],
  [
    "parentheses first behind an argument",
    function run(n) {
      return same(n, (n + n) * converts);
    },
  ],
  [
    "parentheses first in a call",
    function run(n) {
      return same((n + n) * converts);
    },
  ],
  [
    "parentheses first in a call of a member",
    function run(n) {
      return point.x.toString((n + n) * converts);
    },
  ],
  [
    "parentheses first behind a key",
    function run(n) {
      return { b: (n + n) * converts };
    },
  ],
  [
    "parentheses first behind an operand",
    function run(n) {
      return point.x + (n + n) * converts;
    },
  ],
]) {
  show(label, run);
}
