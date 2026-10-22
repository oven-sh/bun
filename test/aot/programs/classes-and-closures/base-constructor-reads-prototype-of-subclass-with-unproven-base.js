function read(o) { return o.z; }
class Base { constructor() { this.seen = read(this); } }
var k; const T = { a: Object, undefined: Base };
function key() { return k; }
class Sub extends T[key()] { }
var k = "a";
Sub.prototype.z = "proto";
console.log(new Sub().seen, new Base().seen);
