function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function summarize(list, scale, label, options) {
  let sum = 0;
  let largest = -Infinity;
  let odd = 0;
  let text = "";
  const seen = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      sum += item * scale;
      if (item > largest) largest = item;
      if (item & 1) odd++;
      switch (i % 3) {
        case 0:
          text += label.charAt(i % label.length);
          break;
        case 1:
          text += label.length;
          break;
        default:
          text += "-";
      }
      seen.push(item);
    }
    if (options.round) sum = Math.round(sum);
    if (options.limit < sum) {
      sum = options.limit;
      text += "!";
    }
    if (seen.length !== list.length) throw new RangeError("the list changed");
  } catch (error) {
    log.push("caught " + error.constructor.name);
    return { failed: true, sum, odd, text, seen: seen.length };
  } finally {
    log.push("finally");
  }
  let check = 0;
  for (const item of seen) check = (check * 31 + (item | 0)) | 0;
  return { sum, largest, odd, text, check };
}

function honest(round) {
  log.length = 0;
  console.log(round, JSON.stringify(summarize([1, 2, 3], 2, "abc", { round: true, limit: 100 })));
  console.log(round, JSON.stringify(summarize([], 1, "x", { round: false, limit: 0 })));
  console.log(round, JSON.stringify(summarize([0.5, 1.5], 0.5, "label", { round: true, limit: 10 })));
  console.log(round, JSON.stringify(summarize(new Array(7, 8, 9, 10), 3, "ab", { round: false, limit: 50 })));
  console.log(round, JSON.stringify(summarize([100], 1, "z", { round: true, limit: 5 })));
  console.log(round, JSON.stringify(summarize([-1, -2], -1, "neg", { round: false, limit: 1000 })));
}

const good = () => [[1, 2, 3], 2, "abc", { round: true, limit: 100 }];
const places = ["list", "scale", "label", "options"];
const impostors = [
  ["a string", () => "123"],
  ["a number", () => 7],
  ["an array of strings", () => ["1", "2", "3"]],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2, round: 1, limit: 1, charAt: () => "?" })],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 2), length: 1, charAt: () => "v", round: true, limit: 3 })],
  ["a typed array", () => new Int16Array([1, 2, 3])],
  ["a BigInt", () => 2n],
  ["an array of BigInts", () => [1n, 2n]],
  ["holes", () => new Array(2)],
  ["a proxy of an array", () => new Proxy([1, 2], {})],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of impostors) {
  for (let place = 0; place < places.length; place++) {
    attempt(places[place] + " is " + name, () => {
      const list = good();
      list[place] = make();
      return summarize(list[0], list[1], list[2], list[3]);
    });
  }
}
attempt("every place at once through apply", () => summarize.apply(null, ["12", "2", ["a", "b"], "options"]));
attempt("too few arguments", () => summarize([1, 2]));
attempt("a list that grows while it is read", () => { const list = [1, 2]; return summarize(new Proxy(list, { get: (target, key) => (key === "1" && target.length < 4 && target.push(9), target[key]) }), 1, "ab", {}); });
attempt("options whose limit is a getter that throws", () => summarize([1], 1, "a", { get limit() { throw new EvalError("no"); } }));
attempt("as a callback", () => [[1, 2, 3]].map(summarize)[0]);
attempt("from hidden code", () => new Function("f", "return f('12', '2', 'ab', {})")(summarize));
honest("after");
