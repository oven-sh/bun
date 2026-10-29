// A read through the proxy calls the trap on the handler, so push stores the three arguments and a length there.
class A {
  ga = 1;
}
const inst = new A();
inst.get = Array.prototype.push;
const holder = JSON.parse("{}");
holder.kept = inst;
try {
  new Proxy({}, holder.kept).x;
} catch (error) {
  console.log(error.name);
}
console.log(typeof inst.length, typeof inst[0], typeof inst.ga);
console.log(Object.keys(inst).join("+"), inst.length, inst.ga);
