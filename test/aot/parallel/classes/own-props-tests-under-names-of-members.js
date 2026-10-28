// Object.hasOwn and hasOwnProperty under the name of an accessor or a method of the class, on instances that have got
// other properties, another prototype, or a property of that very name.
const lines = [];

class Response {
  constructor(id) {
    this.id = id;
  }
  get socket() {
    return "socket of " + this.id;
  }
  set socket(value) {
    this.assigned = value;
  }
  end() {
    return "end of " + this.id;
  }
}

function Request(id) {
  this.id = id;
}
Object.defineProperty(Request.prototype, "socket", {
  get() {
    return "socket of request " + this.id;
  },
});
Request.prototype.end = function () {
  return "end of request " + this.id;
};

class Heir extends Response {
  socket = "a field";
}

function ask(object) {
  return (
    (Object.hasOwn(object, "socket") ? "S" : "s") +
    (Object.hasOwn(object, "end") ? "E" : "e") +
    (Object.prototype.hasOwnProperty.call(object, "socket") ? "S" : "s") +
    (object.hasOwnProperty("end") ? "E" : "e") +
    (Object.hasOwn(object, "other") ? "O" : "o")
  );
}

function askMany(label, objects) {
  let answers = "";
  for (let round = 0; round < 3; round++) for (const object of objects) answers += ask(object) + " ";
  lines.push(label + ": " + answers.trimEnd());
}

function run(make, name) {
  const plain = make(1);
  const decorated = make(2);
  const hidden = make(3);
  const below = make(4);
  const belowHiding = make(5);
  const all = [plain, decorated, hidden, below, belowHiding];
  askMany(name + " as made", all);

  decorated.locals = {};
  decorated.other = 1;
  decorated.__onFinished = null;
  askMany(name + " with other properties", all);

  Object.setPrototypeOf(below, Object.create(Object.getPrototypeOf(below), { extra: { value: 1 } }));
  askMany(name + " with a prototype in between", all);

  Object.setPrototypeOf(
    belowHiding,
    Object.create(Object.getPrototypeOf(belowHiding), { socket: { value: "hides" }, end: { value: "hides" } }),
  );
  askMany(name + " with a prototype that has the names", all);
  lines.push([below.socket, belowHiding.socket, typeof below.end, typeof belowHiding.end].join(" | "));

  Object.defineProperty(hidden, "socket", { value: "own", configurable: true });
  askMany(name + " with an own socket", all);
  lines.push([plain.socket, decorated.socket, hidden.socket].join(" | "));

  hidden.end = "own";
  askMany(name + " with an own end", all);

  delete hidden.socket;
  delete hidden.end;
  askMany(name + " with both deleted", all);

  Reflect.defineProperty(decorated, "socket", { get: () => "own getter", configurable: true });
  Object.defineProperties(plain, { end: { value: 1 } });
  askMany(name + " defined through Reflect and defineProperties", all);

  const late = make(6);
  askMany(name + " made late", [late]);
  Object.assign(late, { end: 2 });
  askMany(name + " assigned late", [late]);
}

run(id => new Response(id), "class");
run(id => new Request(id), "constructor function");
askMany("a field of an heir", [new Heir(7), new Response(8)]);
askMany("objects of no class", [{ socket: 1 }, { end: 1 }, Object.create({ socket: 1, end: 1 }), { other: 1 }]);

console.log(lines.join("\n"));
