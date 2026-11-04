class Dial { constructor() { this.n = 1; } }
let how = "defined"; try { Object.defineProperty(Dial, "prototype", { value: 7 }); } catch (e) { how = e.constructor.name; }
console.log(how, Reflect.set(Dial, "prototype", null), typeof Dial.prototype);
