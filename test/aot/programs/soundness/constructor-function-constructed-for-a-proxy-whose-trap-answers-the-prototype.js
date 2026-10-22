// A constructor function is constructed for a proxy as new.target: the trap answers the object that lies above what is made, and its method is called.
function Legacy() {}
const proxy = new Proxy(function () {}, { get(target, key) { return key === "prototype" ? { peek() { return "peeked"; } } : target[key]; } });
console.log(Reflect.construct(Legacy, [], proxy).peek());
