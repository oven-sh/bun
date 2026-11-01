const custom = Symbol.for("nodejs.util.inspect.custom");
const target = { plain: 1, [custom]() { return "the target's own"; } };
console.log(new Proxy(target, {}));
console.log(new Proxy({ plain: 2 }, { get(object, key, receiver) { return key === custom ? () => "out of the trap" : Reflect.get(object, key, receiver); } }));
