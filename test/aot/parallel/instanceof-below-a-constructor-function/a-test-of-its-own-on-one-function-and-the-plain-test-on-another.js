function Stream() { this.open = true; }
function Writable() { this.w = 1; }
function Other() { this.n = 2; }
Object.defineProperty(Writable, Symbol.hasInstance, { __proto__: null, value: function (object) { return !!object && object.w === 1; } });
console.log(new Other() instanceof Stream, new Stream() instanceof Stream, { w: 1 } instanceof Writable, new Other() instanceof Writable);
