// The program writes `keySet` with a Set alone, behind a spread of an object that the compiler does not know, so a read of that name expects a Set.
// Here the spread-in object, or a later store through an unknown receiver, brings something else each time.
function normalize(def) {
  return { ...def, keySet: new Set(Object.keys(def.shape)) };
}
function count(def, input) {
  const keySet = def.keySet;
  let found = 0;
  for (const key in input) if (keySet.has(key)) found++;
  return found;
}
class Contrary extends Set {
  has(key) {
    return !super.has(key);
  }
}
const parse = text => JSON.parse(text);
const input = { a: 1, b: 2, c: 3 };
const made = normalize(parse('{"shape":{"a":1,"b":2}}'));
const said = [];
const say = (name, def) => {
  try {
    said.push(name + " " + count(def, input));
  } catch (error) {
    said.push(name + " " + error.name);
  }
};
for (let turn = 0; turn < 200; turn++) count(made, input);
say("the set", made);
const holders = [parse("{}"), parse("{}"), parse("{}"), parse("{}"), parse("{}"), parse("{}"), parse("{}")];
const values = [
  new Set([1, 2, "c"]),
  new Contrary(["a"]),
  Object.assign(new Set(["a"]), { has: () => true }),
  { has: key => key === "b" },
  new Map([["c", 0]]),
  undefined,
  "text",
];
const names = ["other contents", "a class below", "an own member", "a plain object", "a map", "undefined", "a string"];
holders.forEach((holder, index) => {
  holder[["keySet"][parse("0")]] = values[index];
  say(names[index], holder);
});
say("the set again", made);
console.log(said.join("\n"));
