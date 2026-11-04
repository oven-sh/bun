let made = 0, reads = 0;
class Crate { constructor() { made++; } }
function Barrel() { made++; }
class Chest extends Crate { constructor(...all) { super(...all); } }
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  return list;
}
for (let i = 0; i < 300; i++) Reflect.construct(Crate, makeList());
console.log(made, reads);
for (let i = 0; i < 300; i++) Reflect.construct(Barrel, makeList());
console.log(made, reads);
for (let i = 0; i < 300; i++) Reflect.construct(Crate, makeList(), Barrel);
console.log(made, reads);
for (let i = 0; i < 300; i++) new Crate(...makeList());
console.log(made, reads);
for (let i = 0; i < 300; i++) new Chest(...makeList());
console.log(made, reads);
