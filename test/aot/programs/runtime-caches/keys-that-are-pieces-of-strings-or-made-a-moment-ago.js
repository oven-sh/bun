// A key need not be a constant: a router cuts the path out of the URL, a parser lowers the name of a header. Such a key is a string that is no name yet, and it has to find what the name finds:
// whatever its length, whether it looks like an index, whether its characters are wide, and whatever has happened to the object in between.
const box = JSON.parse(process.argv[9] ?? "[0]");
function hidden(value) { box[0] = value; return box[0]; }
const log = [];
function note(title, value) { log.push(title + ": " + value); }

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_/";
function nameOfLength(length, seed) { let text = ""; for (let i = 0; i < length; i++) text += alphabet[(seed * 7 + i * 11) % alphabet.length]; return text; }
let names = [];
for (let length = 0; length <= 20; length++) for (let seed = 0; seed < 3; seed++) names.push(nameOfLength(length, seed + length));
names.push("0", "7", "12", "007", "4294967294", "4294967295", "-1", "1.5", "__proto__", "constructor", "toString", "length", "é", "éé", "ÿþý", "a b", "/text", "/json", "get", "utf8", "content-type");
names = [...new Set(names)];

// The ways to make a string that has the text of a name and is not the name.
const padding = "http://localhost:3000";
const makers = {
  piece: text => hidden(padding + text + "?q=1").slice(padding.length, padding.length + text.length),
  pieceOfWide: text => hidden("λ" + text + "λ").slice(1, 1 + text.length),
  joined: text => hidden(text.slice(0, text.length >> 1)) + hidden(text.slice(text.length >> 1)),
  lowered: text => hidden(text.toUpperCase()).toLowerCase() === text ? hidden(text.toUpperCase()).toLowerCase() : hidden(" " + text).trim(),
  trimmed: text => hidden("  " + text + " ").trim() === text ? hidden("  " + text + " ").trim() : hidden(padding + text).slice(padding.length),
  fromCodes: text => String.fromCharCode(...[...text].map(c => c.charCodeAt(0))),
};

class Holder { constructor() { this.get = "field get"; this.utf8 = "field utf8"; this.abc = 1; } get toText() { return "getter"; } method() { return 1; } }
function makeObjects() {
  const ordinary = {}, bare = Object.create(null), below = Object.create({ "/text": "inherited /text", inherited: "yes", 7: "inherited seven" });
  names.forEach((name, i) => { if (i % 3 !== 2) { ordinary[name] = "o" + i; bare[name] = "b" + i; } if (i % 4 === 0) below[name] = "w" + i; });
  const list = ["zero", "one", "two"]; list.get = "named on a list"; list["/text"] = "path on a list";
  const holder = new Holder(); holder["/json"] = "extra /json"; holder["content-type"] = "extra header";
  return { ordinary, bare, below, list, holder, parsed: JSON.parse('{"get":1,"utf8":2,"/text":3,"12":4,"content-type":5}'), text: "text" };
}
function show(value) { return typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : String(value); }
function ask(object, key) {
  let answer = show(object[key]);
  if (typeof object === "object") answer += (key in object ? " in" : " -") + (Object.prototype.hasOwnProperty.call(object, key) ? " own" : " -");
  return answer;
}
function round(title, objects) {
  let differing = 0, digest = 0, asked = 0;
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [kind, object] of Object.entries(objects)) {
      for (const name of names) {
        const expected = ask(object, name);
        for (const [how, make] of Object.entries(makers)) {
          const key = make(name);
          if (key !== name) { note(title, "the maker " + how + " does not make " + JSON.stringify(name)); continue; }
          const got = ask(hidden(object), key);
          asked++;
          if (got !== expected && differing++ < 8) note(title, `${kind}[${how} ${JSON.stringify(name)}] is ${got}, by the name ${expected}`);
        }
        for (let i = 0; i < expected.length; i++) digest = (digest * 31 + expected.charCodeAt(i)) | 0;
      }
    }
  }
  note(title, `${asked} asked, ${differing} differ, digest ${digest}`);
}

let objects = makeObjects();
round("as made", objects);

// Stores, definitions and deletions under such keys.
for (const [how, make] of Object.entries(makers)) {
  names.forEach((name, i) => {
    if (name === "__proto__") return;
    const target = i & 1 ? objects.ordinary : objects.bare;
    if (i % 5 === 0) target[make(name)] = how + " stored " + i;
    if (i % 5 === 1) delete target[make(name)];
    if (i % 5 === 2) Object.defineProperty(target, make(name), { get() { return how + " getter " + i; }, configurable: true, enumerable: true });
    if (i % 7 === 3) objects.holder[make(name)] = how + " on the holder " + i;
  });
  round("after the stores of " + how, objects);
}

// More texts than any table of them holds, again and again, with collections in between.
const many = {};
for (let i = 0; i < 700; i++) many["key-" + i] = i;
let sum = 0;
for (let repeat = 0; repeat < 6; repeat++) {
  for (let i = 0; i < 700; i++) sum += many[hidden("prefix:key-" + i + ":suffix").slice(7, 7 + 4 + String(i).length)];
  if (typeof Bun !== "undefined") Bun.gc(true);
  objects = repeat === 3 ? makeObjects() : objects;
}
note("many texts", sum);
round("behind the collections", objects);
console.log(log.join("\n"));
