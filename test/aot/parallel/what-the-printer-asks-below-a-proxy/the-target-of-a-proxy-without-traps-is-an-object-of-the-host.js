// Without a `get` trap the question of the printer goes on at the target: an object of a class of the host whose prototype has the method.
const below = Object.create(new Proxy(new URLSearchParams("a=1"), {}));
try { console.log(below); } catch (error) { console.log(error.constructor.name); }
console.log(new Proxy(new URL("https://example.com/a"), {}));
