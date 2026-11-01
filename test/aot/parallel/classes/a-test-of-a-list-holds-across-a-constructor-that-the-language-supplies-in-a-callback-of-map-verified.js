// Flags: --aot-check=verify-each-pass
// The list that map() fills is tested once in front of its loop, and the callback that is put in line makes an object of a class without a written constructor.
class Base { constructor(flag) { this.value = flag ? 1 : 2; } }
class Derived extends Base { run = () => this.value; }
const results = () => [false, true].map(flag => { const made = new Derived(flag); return typeof made.run === "function" ? made.run() : "no function"; });
let sum = 0;
for (let i = 0; i < 3000; i++) sum += results()[i & 1];
console.log(sum, String(results()));
