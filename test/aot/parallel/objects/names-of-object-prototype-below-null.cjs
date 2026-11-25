// Names of Object.prototype read off objects that stand below null and get names that no list tells.
function attempt(f) {
  try {
    console.log(typeof f());
  } catch (error) {
    console.log(error.name);
  }
}
const words = Object.create(null);
words.v = 3;
function readAll() {
  attempt(() => words.valueOf);
  attempt(() => "zip" in words);
  attempt(() => words.kind === words.kind);
  attempt(() => words.kind(2));
  attempt(() => words.size);
}
readAll();
function put(target, name) {
  target[name] = [name];
}
function addAll(names) {
  for (const name of names) put(words, name);
}
addAll(["size"]);
readAll();
const others = { __proto__: null, v: 3 };
function readOthers() {
  attempt(() => others.toString);
  attempt(() => others.hasOwnProperty);
  attempt(() => others.toString === undefined);
  attempt(() => others.kind(2));
  attempt(() => others.size);
  attempt(() => others.toString());
}
readOthers();
put(others, "size");
readOthers();
