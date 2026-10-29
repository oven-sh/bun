// f.apply(receiver, list) where f is no function, or list is no list, or both: which of the two is refused, and which getters of the list have run by then.
const said = [];
const notCallable = Object.create(Function.prototype);
const lists = [
  ["number", 1],
  ["text", "ab"],
  ["true", true],
  ["symbol", Symbol("s")],
  ["bigint", 1n],
  ["undefined", undefined],
  ["null", null],
  ["list", [1]],
  ["empty", []],
  [
    "getters",
    {
      get length() {
        said.push("length");
        return 1;
      },
      get 0() {
        said.push("0");
        return 1;
      },
    },
  ],
  [
    "length throws",
    {
      get length() {
        throw new Error("length");
      },
    },
  ],
  [
    "element throws",
    {
      length: 1,
      get 0() {
        throw new Error("element");
      },
    },
  ],
  ["function", function (a, b) {}],
  ["holes", [, 1]],
  [
    "proxy",
    new Proxy([1], {
      get(target, key) {
        said.push("get " + String(key));
        return target[key];
      },
    }),
  ],
  ["too long", { length: 2 ** 31 }],
];
// How the callee is named in the message is the subject of other programs.
const worded = message => message.split(" (")[0].replace(/^.* is not a function\.?$/, "what is called is not a function");
function show(label, run) {
  for (const [name, list] of lists) {
    said.length = 0;
    try {
      console.log(label, name, "returned", String(run(list)), said.join());
    } catch (error) {
      console.log(label, name, error.name + ": " + worded(error.message), said.join());
    }
  }
}
const counts = function () {
  return arguments.length;
};
show("an object", list => notCallable.apply(null, list));
show("an object, not in tail position", list => {
  const result = notCallable.apply(null, list);
  return result;
});
show("a function", list => counts.apply(null, list));
show("a function, not in tail position", list => {
  const result = counts.apply(null, list);
  return result;
});
show("a parameter", list => (f => f.apply(null, list))(notCallable));
show("one of two", list => (said.length ? counts : notCallable).apply(null, list));
show("apply.call", list => Function.prototype.apply.call(notCallable, null, list));
show("apply.call of undefined", list => Function.prototype.apply.call(undefined, null, list));
show("apply.call of a number", list => Function.prototype.apply.call(5, null, list));
show("apply read first", list => {
  const apply = notCallable.apply;
  return apply.call(notCallable, null, list);
});
show("apply bound", list => Function.prototype.apply.bind(notCallable)(null, list));
show("apply applied", list => Function.prototype.apply.apply(notCallable, [null, list]));
show("Reflect.apply", list => Reflect.apply(notCallable, null, list));
show("Reflect.apply of undefined", list => Reflect.apply(undefined, null, list));
show("Reflect.apply of a function", list => Reflect.apply(counts, null, list));
show("Reflect.apply of apply", list => Reflect.apply(Function.prototype.apply, notCallable, [null, list]));
show("Reflect.construct", list => Reflect.construct(notCallable, list));
show("a class", list => class {}.apply(null, list));
show("a bound function", list => counts.bind(null, 1).apply(null, list));
show("a proxy of an object", list => new Proxy(notCallable, {}).apply(null, list));
function own() {
  return notCallable.apply(this, arguments);
}
show("own arguments", list => own(list));
function ownOfAParameter(f) {
  return f.apply(this, arguments);
}
show("own arguments of a parameter", list => ownOfAParameter(notCallable, list));
