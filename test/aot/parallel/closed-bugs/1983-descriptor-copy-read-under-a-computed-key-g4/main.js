// Flags: --aot-validate
const source = Object.prototype;
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
console.log(typeof { toString: r.toString }.toString, r.toString === source.toString, Object.keys(r).length, typeof r.__proto__);
