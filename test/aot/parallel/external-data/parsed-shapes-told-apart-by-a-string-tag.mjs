// Objects of which the compiler knows nothing, most of them out of JSON.parse(), are told apart by a string tag, and what is
// read from them is reckoned with and added to a number. The values are numbers in most turns and anything else in some.
function size(shape) {
  if (shape.kind === "circle") return shape.radius + shape.radius;
  return shape.side;
}
function sizes(shapes) {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) sum += size(shapes[i]);
  return sum;
}
function show(name, run) {
  try {
    const answer = run();
    console.log(name, typeof answer, Object.is(answer, -0) ? "-0" : String(answer));
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}
function many(text, count = 300) {
  return JSON.parse("[" + Array(count).fill(text).join(",") + "]");
}
const circle = radius => `{"kind":"circle","radius":${radius}}`;

show("fractions", () => sizes(many(circle(1.25) + "," + `{"kind":"square","side":0.5}`)));
show("integers", () => sizes(many(circle(3) + "," + `{"kind":"square","side":4}`)));
show("an integer and fractions", () => sizes(many(circle(3) + "," + circle(0.5))));
show("beyond int32", () => sizes(many(circle(2147483647), 3)));
show("below int32", () => sizes(many(circle(-2147483648), 3)));
show("huge", () => sizes(many(circle("1e308"), 2)));
show("minus zero", () => size(JSON.parse(circle("-0"))));
show("texts", () => sizes(many(circle('"ab"'), 3)));
show("a text behind numbers", () => sizes([...many(circle(1), 50), ...many(circle('"x"'), 2), ...many(circle(2), 2)]));
show("null", () => sizes(many(circle("null"))));
show("true", () => sizes(many(circle("true"))));
show("missing", () => sizes(many(`{"kind":"circle"}`)));
show("a list", () => sizes(many(circle("[1,2]"), 2)));
show("an object", () => sizes(many(circle("{}"), 2)));
show("no side", () => sizes(many(`{"kind":"square"}`, 2)));
show("a side that is a text", () => sizes(many(`{"kind":"square","side":"s"}`, 2)));
show("BigInts", () => size({ kind: "circle", radius: 5n }));
show("BigInts added to a number", () => sizes([{ kind: "circle", radius: 5n }]));
show("a symbol", () => size({ kind: "circle", radius: Symbol() }));
show("no object", () => sizes([null]));
show("a number for a shape", () => sizes([7, 8]));
show("a text for a shape", () => sizes(["circle"]));

// Both reads happen, in order, and so do both conversions.
const log = [];
let reads = 0;
const counted = {
  kind: "circle",
  get radius() {
    const read = ++reads;
    return { valueOf: () => (log.push("valueOf " + read), read) };
  },
};
show("getters and valueOf", () => sizes([counted, counted]));
console.log(reads, log.join(", "));
let turn = 0;
const changing = { kind: "circle", get radius() { return turn++ ? "text" : 1; } };
show("a getter that answers differently", () => size(changing));
show("a proxy", () => sizes([new Proxy({}, { get: (target, key) => (key === "kind" ? "circle" : 21) })]));
show("inherited", () => sizes(many("{}", 5).map(() => Object.create({ kind: "circle", radius: 1.5 }))));

// The tag: only a string with these six characters is the same, however it is held.
const rope = text => text.slice(0, 3) + text.slice(3);
const wide = text => (text + "Ā").slice(0, text.length);
const tags = ["circle", rope("circle" + ""), wide("circle"), rope(wide("circle")), "circlE", "Circle", "circl", "circles", "", "square", "c", wide("circlE"), "Āircle",
  new String("circle"), { toString: () => "circle" }, ["circle"], 0, NaN, null, undefined, true, 6n, Symbol("circle")];
for (let round = 0; round < 3; round++) {
  let text = "";
  for (let i = 0; i < tags.length; i++) text += size({ kind: tags[i], radius: 1, side: 0 });
  console.log(text);
}
show("long ropes", () => {
  let count = 0;
  for (let i = 0; i < 300; i++) count += size({ kind: "cir".concat(i % 2 ? "cle" : "cus"), radius: 1, side: 0 });
  return count;
});

// The other operators that make numbers of numbers, and a sum that is compared with a number.
function reckon(records, limit) {
  let sum = 0, below = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    sum += record.a - record.b;
    sum += record.a * record.b;
    sum += record.a / record.b;
    sum += record.a % record.b;
    sum += record.a ** record.b;
    if (record.a + record.b < limit) below++;
  }
  return sum + " " + below;
}
show("reckoned with fractions", () => reckon(many(`{"a":7.5,"b":2}`), 10));
show("reckoned with integers", () => reckon(many(`{"a":7,"b":2}`), 9));
show("reckoned with zero", () => reckon(many(`{"a":0,"b":0}`, 2), 0));
show("reckoned with texts of numbers", () => reckon(many(`{"a":"7","b":"2"}`, 2), 100));
show("reckoned with texts", () => reckon(many(`{"a":"x","b":"y"}`, 2), 100));
show("reckoned with nothing", () => reckon(many("{}", 2), 100));
show("reckoned with null", () => reckon(many(`{"a":null,"b":3}`, 2), 100));
show("reckoned with BigInts", () => reckon([{ a: 7n, b: 2n }], 100));
show("reckoned with a BigInt and a number", () => reckon([{ a: 7n, b: 2 }], 100));

// A sum that is joined to a text stays what it is.
function names(people) {
  let text = "";
  for (let i = 0; i < people.length; i++) text += people[i].first + people[i].last;
  return text;
}
show("names", () => names(many(`{"first":"a","last":"b"}`, 3)));
show("numbers for names", () => names(many(`{"first":1,"last":2}`, 3)));

// The same comparison wherever it may stand: the text on the left, `!==`, a switch, behind a handler, and between suspensions.
const mixed = JSON.parse("[" + Array.from({ length: 90 }, (_, i) => (i % 3 ? circle(i + 0.5) : `{"kind":"square","side":${i}}`)).join(",") + "]");
function textOnLeft(shapes) {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if ("circle" === shape.kind) sum += shape.radius;
    else sum -= shape.side;
  }
  return sum;
}
function notTheSame(shapes) {
  let sum = 0;
  for (const shape of shapes) {
    if (shape.kind !== "circle") sum += shape.side;
    else sum += shape.radius * shape.radius;
  }
  return sum;
}
function bySwitch(shapes) {
  let sum = 0;
  for (const shape of shapes) {
    switch (shape.kind) {
      case "circle": sum += shape.radius; break;
      case "square": sum += shape.side + shape.side; break;
      default: sum = -1;
    }
  }
  return sum;
}
function twoTags(shapes) {
  let sum = 0;
  for (let i = 1; i < shapes.length; i++) {
    const a = shapes[i - 1], b = shapes[i];
    if (a.kind === "circle" && b.kind === "circle") sum += a.radius + b.radius;
    else if (a.kind === "circle" || b.kind === "circle") sum += 1;
  }
  return sum;
}
function behindHandler(shapes) {
  let sum = 0;
  for (let i = 0; i <= shapes.length; i++) {
    try {
      const shape = shapes[i];
      if (shape.kind === "circle") sum += shape.radius;
    } catch (error) {
      sum += error instanceof TypeError ? 1000 : -1000;
    } finally {
      sum += 1;
    }
  }
  return sum;
}
function* yielded(shapes) {
  for (const shape of shapes) {
    const before = yield 0;
    if (shape.kind === "circle") yield shape.radius + before;
    else yield shape.side;
  }
}
async function awaited(shapes) {
  let sum = 0;
  for (const shape of shapes) {
    const one = await 1;
    if (shape.kind === "circle") sum += (await shape.radius) + one;
    else sum += shape.side;
  }
  return sum;
}
async function* yieldedAndAwaited(shapes) {
  for (const shape of shapes) {
    await null;
    if (shape.kind === "circle") yield shape.radius + shape.radius;
    else yield await shape.side;
  }
}
show("the text on the left", () => textOnLeft(mixed));
show("not the same", () => notTheSame(mixed));
show("a switch", () => bySwitch(mixed));
show("a switch that finds neither", () => bySwitch(many(`{"kind":"line"}`, 2)));
show("two tags", () => twoTags(mixed));
show("behind a handler", () => behindHandler(mixed));
show("a generator", () => {
  let sum = 0;
  const steps = yielded(mixed);
  for (let step = steps.next(); !step.done; step = steps.next(2)) sum += step.value;
  return sum;
});
console.log("an async function", await awaited(mixed));
let total = 0;
for await (const value of yieldedAndAwaited(mixed)) total += value;
console.log("an async generator", total);

// Texts of every length: a short one goes to the comparison in a register, a long one by its number. Every arm narrows `record`.
function inLoops(record) {
  if (record.tag === "") return record.at + 0;
  if (record.tag === "a") return record.at + 1;
  if (record.tag === "ab") return record.at + 2;
  if (record.tag === "abc") return record.at + 3;
  if (record.tag === "abcd") return record.at + 4;
  if (record.tag === "abcde") return record.at + 5;
  if (record.tag === "abcdef") return record.at + 6;
  if (record.tag === "abcdefg") return record.at + 7;
  if (record.tag === "abcdefgh") return record.at + 8;
  if (record.tag === "abcdefghi") return record.at + 9;
  if (record.tag === "abcdefghijklmnopq") return record.at + 17;
  if (record.tag === "Ā") return record.at + 100;
  if (record.tag === "aĀc") return record.at + 101;
  if (record.tag === "été") return record.at + 102;
  return record.at - 1;
}
function inLineOnly(record) {
  if (record.tag === "") return record.at + 0;
  if (record.tag === "a") return record.at + 1;
  if (record.tag === "ab") return record.at + 2;
  if (record.tag === "abc") return record.at + 3;
  if (record.tag === "abcd") return record.at + 4;
  if (record.tag === "abcde") return record.at + 5;
  if (record.tag === "abcdef") return record.at + 6;
  if (record.tag === "abcdefg") return record.at + 7;
  if (record.tag === "abcdefgh") return record.at + 8;
  if (record.tag === "abcdefghi") return record.at + 9;
  if (record.tag === "abcdefghijklmnopq") return record.at + 17;
  if (record.tag === "Ā") return record.at + 100;
  if (record.tag === "aĀc") return record.at + 101;
  if (record.tag === "été") return record.at + 102;
  return record.at - 1;
}
const words = ["", "a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmnopq", "Ā", "aĀc", "été",
  "b", "aB", "abcdefG", "abcdefgH", "abcdefghI", "abcdefghijklmnopQ", "abcdefghijklmnop", "ā", "aĀd", "étè", "ete"];
const halves = text => text.slice(0, text.length >> 1).concat(text.slice(text.length >> 1));
const held = [text => text, halves, wide, text => halves(wide(text)), text => JSON.parse(JSON.stringify(text))];
for (const hold of held) {
  let line = "";
  for (const word of words) line += inLoops({ tag: hold(word), at: 0 }) + " ";
  console.log(line);
}
const w = (index, hold) => ({ tag: held[hold](words[index]), at: 0 });
console.log(inLineOnly(w(0, 0)), inLineOnly(w(1, 1)), inLineOnly(w(2, 2)), inLineOnly(w(3, 3)), inLineOnly(w(4, 4)), inLineOnly(w(5, 0)), inLineOnly(w(6, 1)), inLineOnly(w(7, 2)));
console.log(inLineOnly(w(7, 3)), inLineOnly(w(8, 4)), inLineOnly(w(8, 1)), inLineOnly(w(9, 2)), inLineOnly(w(10, 3)), inLineOnly(w(10, 0)), inLineOnly(w(11, 0)), inLineOnly(w(12, 1)));
console.log(inLineOnly(w(13, 2)), inLineOnly(w(13, 0)), inLineOnly(w(14, 0)), inLineOnly(w(16, 1)), inLineOnly(w(17, 2)), inLineOnly(w(19, 3)), inLineOnly(w(20, 4)), inLineOnly(w(24, 0)));
console.log(inLineOnly({ tag: 0, at: 0 }), inLineOnly({ tag: null, at: 0 }), inLineOnly({ at: 0 }), inLineOnly({ tag: new String("ab"), at: 0 }), inLineOnly({ tag: ["a"], at: 0 }), inLineOnly({ tag: Symbol("a"), at: 0 }), inLineOnly({ tag: 1n, at: 0 }), inLineOnly({ tag: false, at: 0 }));
