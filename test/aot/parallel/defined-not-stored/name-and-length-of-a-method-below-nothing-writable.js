class Holder { method(first, second) {} static fixed(first) {} get read() { return 1; } }
const found = Object.getOwnPropertyDescriptor(Holder.prototype, "read");
console.log(Holder.prototype.method.name, Holder.prototype.method.length, Holder.fixed.name, Holder.fixed.length, found.get.name, found.get.length);
