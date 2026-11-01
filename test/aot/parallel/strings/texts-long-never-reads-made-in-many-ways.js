// Texts that would pass the longest text there can be are made in many ways, and nobody reads them.
let half = "x";
for (let i = 0; i < 30; i++) half += half; // 2 ** 30 characters, a rope
const say = (name, make) => {
  let seen = "";
  for (let turn = 0; turn < 3; turn++) {
    try {
      make(half, half);
      seen += " no error";
    } catch (error) {
      seen += " " + error.constructor.name;
    }
  }
  console.log(name + seen);
};
say("plus", (a, b) => {
  a + b;
});
say("plus three", (a, b) => {
  a + "-" + b;
});
say("plus assigned", (a, b) => {
  let text = a;
  text += b;
});
say("template", (a, b) => {
  `${a}${b}`;
});
say("template with text", (a, b) => {
  `<${a}|${b}>`;
});
say("concat", (a, b) => {
  a.concat(b);
});
say("repeat", (a, b) => {
  a.repeat(2);
});
say("repeat small", (a, b) => {
  "ab".repeat(2 ** 30);
});
say("padStart", (a, b) => {
  "x".padStart(2 ** 31);
});
say("join", (a, b) => {
  [a, b].join("");
});
say("join with comma", (a, b) => {
  [a, b].join();
});
say("String.raw", (a, b) => {
  String.raw`${a}${b}`;
});
say("loop", (a, b) => {
  let text = "";
  for (let i = 0; i < 4; i++) text += a;
});
say("loop of pieces", (a, b) => {
  let text = "";
  for (let i = 0; i < 4; i++) text += a + "," + i;
});
say("length alone is read", (a, b) => {
  if ((a + b).length === 0) console.log("empty");
});
say("compared with empty", (a, b) => {
  if (a + b === "") console.log("empty");
});
say("truthiness", (a, b) => {
  if (!(a + b)) console.log("empty");
});
say("typeof", (a, b) => {
  if (typeof (a + b) !== "string") console.log("no text");
});
say("held in an object nobody reads", (a, b) => {
  const holder = { text: a + b };
});
say("held in an array nobody reads", (a, b) => {
  const holder = [a + b];
});
say("argument nobody reads", (a, b) => {
  (unused => 1)(a + b);
});
say("result nobody reads", (a, b) => {
  ((x, y) => x + y)(a, b);
});
say("number and text", (a, b) => {
  1 + a + b;
});
say("key nobody finds", (a, b) => {
  ({})[a + b];
});
say("in", (a, b) => {
  a + b in {};
});
