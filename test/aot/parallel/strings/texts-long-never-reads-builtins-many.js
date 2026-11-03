// Texts that would pass the longest text there can be are made by built-ins and in many places of a program, and nobody reads them.
let half = "x";
for (let i = 0; i < 30; i++) half += half; // 2 ** 30 characters, a rope
const say = (name, make) => {
  let seen = "";
  for (let turn = 0; turn < 2; turn++) {
    try {
      make(half, half);
      seen += " no error";
    } catch (error) {
      seen += " " + error.constructor.name;
    }
  }
  console.log(name + seen);
};
say("concat of two", (a, b) => {
  a.concat(b, "-");
});
say("concat on a short text", (a, b) => {
  "-".concat(a, b);
});
say("concat of numbers", (a, b) => {
  a.concat(1, b, 2);
});
say("join of three", (a, b) => {
  [a, "-", b].join("+");
});
say("join of a list that grew", (a, b) => {
  const list = [];
  list.push(a);
  list.push(b);
  list.join("");
});
say("join by a long text", (a, b) => {
  [1, 2, 3].join(a);
});
say("toString of a list", (a, b) => {
  [a, b].toString();
});
say("String of a list", (a, b) => {
  String([a, b]);
});
say("list plus text", (a, b) => {
  [a, b] + "";
});
say("template of a list", (a, b) => {
  `${[a, b]}`;
});
say("toString of a filled list", (a, b) => {
  Array(3).fill(a).toString();
});
say("toLocaleString of a list", (a, b) => {
  [a, b].toLocaleString();
});
say("padEnd", (a, b) => {
  "x".padEnd(2 ** 31);
});
say("padEnd by a text", (a, b) => {
  a.padEnd(2 ** 31, "ab");
});
say("padStart by a computed number", (a, b) => {
  "x".padStart(a.length * 2);
});
say("repeat by a computed number", (a, b) => {
  "xy".repeat(a.length);
});
say("replace", (a, b) => {
  "<>".replace("<", a).replace(">", b);
});
say("replace by pattern", (a, b) => {
  "<><>".replace(/</g, a);
});
say("replaceAll", (a, b) => {
  "<><>".replaceAll("<", a);
});
say("replaceAll by pattern", (a, b) => {
  "<><>".replaceAll(/</g, a);
});
say("String.raw with text", (a, b) => {
  String.raw`<${a}|${b}>`;
});
say("anchor", (a, b) => {
  a.anchor(b);
});
say("text of an error", (a, b) => {
  const error = new Error(b);
  error.name = a;
  error.toString();
});
say("reduce", (a, b) => {
  [a, b].reduce((x, y) => x + y, "");
});
say("map and join", (a, b) => {
  [a, b].map(x => x + "-").join("");
});
say("for of", (a, b) => {
  let text = "";
  for (const part of [a, b]) text += part;
});
say("in one arm", (a, b) => {
  let text = a;
  if (b.length > 1) text += b;
});
say("two functions deep", (a, b) => {
  const inner = x => x + b;
  const outer = x => inner(x) + "!";
  outer(a);
});
say("class field", (a, b) => {
  class Holder {
    text = a + b;
  }
  new Holder();
});
say("default of a parameter", (a, b) => {
  ((x, y = x + b) => 1)(a);
});
say("comma", (a, b) => {
  (a + b, 1);
});
say("void", (a, b) => {
  void (a + b);
});
say("or", (a, b) => {
  a + b || 1;
});
say("nullish", (a, b) => {
  a + b ?? 1;
});
say("not not", (a, b) => {
  !!(a + b);
});
say("compared with the same", (a, b) => {
  a + b === a + b;
});
say("switch", (a, b) => {
  switch (a + b) {
    default:
  }
});
say("spread", (a, b) => {
  [...[a + b]];
});
say("destructured", (a, b) => {
  const [first] = [a + b];
});
say("yielded", (a, b) => {
  (function* () {
    yield a + b;
  })().next();
});
say("numbers between", (a, b) => {
  a + 1 + b + 2;
});
say("a BigInt between", (a, b) => {
  a + 1n + b;
});
say("null between", (a, b) => {
  a + null + b;
});
say("a String object", (a, b) => {
  new String(a) + b;
});
say("one character too many", (a, b) => {
  a + b.slice(1) + "ab";
});
say("as long as a text may be", (a, b) => {
  a + b.slice(1);
});
say("nothing added", (a, b) => {
  a + b.slice(1) + "";
});
