// A lookup on import.meta goes on to Object.prototype, and whoever asks what stands above import.meta is told null.
const m = import.meta;
const ask = x => [Object.getPrototypeOf(x), Reflect.getPrototypeOf(x), x.__proto__, x instanceof Object, Object.prototype.isPrototypeOf(x), Object.prototype.isPrototypeOf.call(Object.prototype, x)];
console.log(Object.getPrototypeOf(import.meta) === null, Object.getPrototypeOf(import.meta) === Object.prototype, Object.getPrototypeOf(import.meta));
console.log(Reflect.getPrototypeOf(import.meta) === null, Reflect.getPrototypeOf(import.meta) === Object.prototype);
console.log(import.meta.__proto__ === null, import.meta.__proto__ === Object.prototype, typeof import.meta.__proto__, import.meta.__proto__);
console.log(import.meta instanceof Object, Object.prototype.isPrototypeOf(import.meta), Function.prototype[Symbol.hasInstance].call(Object, import.meta));
console.log(Object.getPrototypeOf(m) === null, m.__proto__ === null, m instanceof Object, Object.prototype.isPrototypeOf(m));
console.log(ask(m), ask(import.meta), ask({ held: m }.held));
if (Object.getPrototypeOf(import.meta)) console.log("has something above"); else console.log("has nothing above");
if (import.meta instanceof Object) console.log("is an Object"); else console.log("is no Object");
let steps = 0; for (let o = import.meta; o !== null && steps < 5; o = Object.getPrototypeOf(o)) steps++; console.log(steps);
console.log(import.meta.toString === Object.prototype.toString, import.meta.hasOwnProperty("url"), import.meta.valueOf() === import.meta, import.meta.constructor === Object);
console.log(import.meta.nothing, "nothing" in import.meta, "toString" in import.meta, "url" in import.meta, import.meta.propertyIsEnumerable("url"));
console.log(Object.prototype.toString.call(import.meta), String(import.meta), `${import.meta}`, import.meta[Symbol.toStringTag]);
const below = Object.create(import.meta); console.log(typeof below.url, below.url === import.meta.url, Object.getPrototypeOf(below) === import.meta, below instanceof Object, typeof below.toString);
class Above { get seen() { return "from the class"; } }
console.log(Reflect.setPrototypeOf(import.meta, Above.prototype), Object.getPrototypeOf(import.meta), import.meta.seen, typeof import.meta.url, import.meta instanceof Above, typeof import.meta.toString);
