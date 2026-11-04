// The first generator of a program is made behind a prototype that got an indexed property while the realm held the Structure of an Array subclass made through a Proxy: the realm forgets its Structures there.
function make() { class B extends Array {} const D = new Proxy(B, {}); return new D(); }
make();
class V2 {}
class V3 extends V2 {}
Object.defineProperty(V3.prototype, "0", {});
function lay() { Object.defineProperty(V2.prototype, "0", {}); }
lay();
function* count() { yield 1; yield 2; }
const list = [function* () {}(), count()];
for (let i = 0; i < list.length; i++) try { list[i][0][1].length; } catch (e) { console.log("caught"); }
for (let i = 0; i < list.length; i++) { const step = list[i].next(); console.log(step.value + " " + step.done); }
console.log(Object.getPrototypeOf(list[1]) === count.prototype);
console.log(list[1] instanceof count);
console.log(Object.getPrototypeOf(list[0]) === count.prototype);
console.log(list[1].next().value);
