// A function created at run time adds a property that shadows an array method to one array after another. From the second array on, the interpreter adds it through its inline cache, and compiled code must still call the array's own property.
const tag = new Function("a", "a.extra = 1; a.push = function () { return -1; };");
const x: number[] = [1];
const y: number[] = [2];
tag(x);
tag(y);
console.log("x.push(3):", x.push(3), "length:", x.length);
console.log("y.push(3):", y.push(3), "length:", y.length);

// Every text stores `extra` first. That store allocates the storage for named properties, and the interpreter caches only a store that finds room there.
const adding = (statement: string) => new Function("list", "list.extra = 1; " + statement);
// The base class returns its argument, so the fields of the derived class are defined on the array.
const classDefining = (members: string) => new Function(`class ReturnsArgument { constructor(list) { list.extra = 1; return list; } } return class extends ReturnsArgument { ${members} };`)();
const DefinesJoin = classDefining("join = function () { return 'own join from a field'; };");
const DefinesPrivateField = classDefining("#mark = 7; static read(list) { return list.#mark; }");

const cases: { name: string; add: Function; use: (list: number[]) => unknown }[] = [
  { name: "push", add: adding("list.push = function () { return -1; };"), use: list => list.push(3) },
  { name: "indexOf", add: adding("list.indexOf = function () { return -2; };"), use: list => list.indexOf(list[0]) },
  { name: "join", add: adding("list.join = function () { return 'own join'; };"), use: list => list.join("+") },
  { name: "map", add: adding("list.map = function () { return [-3]; };"), use: list => list.map(value => value + 1) },
  { name: "toJSON", add: adding("list.toJSON = function () { return 'own toJSON'; };"), use: list => JSON.stringify(list) },
  { name: "then", add: adding("list.then = function (resolve) { resolve([-4]); };"), use: async list => await list },
  { name: "join as a class field", add: (list: number[]) => new DefinesJoin(list), use: list => list.join("+") },
  { name: "private field", add: (list: number[]) => new DefinesPrivateField(list), use: list => [DefinesPrivateField.read(list), list.push(3)] },
  { name: "name that shadows nothing", add: adding("list.other = 2;"), use: list => list.push(3) },
];

for (const { name, add, use } of cases) {
  for (let round = 1; round <= 3; round++) {
    const list: number[] = [round];
    add(list);
    console.log(`${name}, array ${round}:`, await use(list), "length:", list.length);
  }
}

export {};
