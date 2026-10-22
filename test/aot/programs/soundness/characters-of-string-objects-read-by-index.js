// A String object has the characters of its string as own properties under indexes, so a read by index answers a string below the length and goes on to the prototypes from there.
function kindOf(value) {
  return typeof value;
}

const text = new String("abc");
const second = text[1];
console.log(second === undefined, typeof second, second + "!", second.length);
console.log(kindOf(new String("abc")[0]), kindOf(Object("abc")[1]), kindOf(new Object("abc")[2]));
console.log(text[3] === undefined, kindOf(text[3]), text[-1], text[1.5], text["01"]);
console.log(text["1"], text["2"].toUpperCase(), text[0].charCodeAt(0), text?.[1], text[1] ?? "none", text[7] ?? "none");
console.log(text[1] ? "filled" : "empty", text[1] === "b", text[1] == "b", text[1] !== undefined, text[1] != null);

function line(name, body) {
  try {
    console.log(name, JSON.stringify(body()));
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}

line("every index", () => {
  const object = new String("abc");
  const seen = [];
  for (let index = -1; index < 5; index++) seen.push(kindOf(object[index]));
  return seen;
});
line("keys that are strings", () => {
  const object = new String("abc");
  return ["0", "2", "3", "7", "length", "at", "01", "-0"].map(key => kindOf(object[key]));
});
line("text nobody knows", () => {
  const object = new String(process.argv.length);
  const first = object[0];
  return [first === undefined, kindOf(first), first.length];
});
line("a conversion of a value nobody knows", () => {
  const object = Object(process.argv[0]);
  const first = object[0];
  return [first === undefined, kindOf(first), first.length, kindOf(Object(process.argv.length)[0]), kindOf(Object(process.argv)[0])];
});
line("no text", () => {
  const object = new String();
  const first = object[0];
  return [first === undefined, kindOf(first), object.length];
});
line("a class below String", () => {
  class Text extends String {}
  const object = new Text("abc");
  const character = object[1];
  return [character === undefined, kindOf(character), character.length, kindOf(object[3])];
});
line("a class below String with a field", () => {
  class Tagged extends String {
    tag = 1;
  }
  const object = new Tagged("abc");
  const character = object[2];
  return [character === undefined, kindOf(character), character.length, object.tag, Object.keys(object)];
});
line("constructed by Reflect", () => {
  const object = Reflect.construct(String, ["abc"]);
  const character = object[1];
  return [character === undefined, kindOf(character), character.length];
});
line("constructed for another class", () => {
  class Other {}
  const object = Reflect.construct(String, ["abc"], Other);
  const character = object[1];
  return [character === undefined, kindOf(character), character.length, object instanceof Other, object instanceof String];
});
line("an heir", () => {
  const heir = Object.create(new String("abc"));
  const character = heir[1];
  return [character === undefined, kindOf(character), character.length, kindOf(heir[3]), 1 in heir, Object.hasOwn(heir, 1)];
});
line("an heir of an heir", () => {
  const heir = Object.create(Object.create(new String("abc")));
  return [heir[0].length, heir.length, kindOf(heir[5])];
});
line("a prototype given later", () => {
  const heir = { own: 1 };
  Object.setPrototypeOf(heir, new String("xy"));
  const character = heir[1];
  return [character === undefined, kindOf(character), character.length];
});
line("through a helper", () => {
  function at(object, index) {
    return object[index];
  }
  return [kindOf(at(new String("abc"), 1)), kindOf(at([1], 0)), kindOf(at(new String("abc"), 4)), kindOf(at("abc", 1)), kindOf(at({ 1: null }, 1))];
});
line("out of an array and a field", () => {
  const list = [new String("ab"), new String("cd")];
  const holder = { text: new String("ef") };
  return [list.map(object => object[0].length), holder.text[1].length, list[1][1]];
});
line("beside an array", () => {
  const seen = [];
  for (const object of [new String("ab"), ["x", 1], new String("")]) seen.push(kindOf(object[0]), kindOf(object[1]));
  return seen;
});
line("other wrappers have none", () => [kindOf(new Number(12)[0]), kindOf(new Boolean(true)[0]), kindOf(Object(Symbol.iterator)[0]), kindOf(Object(1n)[0])]);
line("the prototype object is an empty one", () => [kindOf(String.prototype[0]), String.prototype.length]);
