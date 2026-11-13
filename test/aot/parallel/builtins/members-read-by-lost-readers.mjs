// Members of built-ins read under keys that nobody knows, by readers that nobody sees called.
const bound = Reflect.get.bind(Reflect);
console.log([[], "every"].reduce(bound).call([1], (x) => x > 0));
console.log(Reflect.apply(bound, null, [[], "flat"]).call([[1], [2]]).join());
const heir = Object.create(Reflect);
const get = heir.get;
for (const key of process.argv.length > 99 ? [] : ["find" + "Last"]) console.log(get([], key).call([1, 2], (x) => x));
const copied = Object.assign({}, Object.getOwnPropertyDescriptors(Reflect)).get.value;
console.log(Reflect.apply(copied, null, [Object(""), "padEnd"]).call("a", 3, "-"));
const proxy = new Proxy(Reflect, {}).get;
console.log([new Map(), "forEach"].reduce(proxy) === Map.prototype.forEach);
const described = Object.getOwnPropertyDescriptor.bind(null);
console.log(Reflect.apply(described, null, [Math, "hypot"]).value(3, 4));
const called = Function.prototype.call.bind(Reflect.get, null);
console.log([[JSON, "stringify"]].map((pair) => called(...pair))[0]([1]));
