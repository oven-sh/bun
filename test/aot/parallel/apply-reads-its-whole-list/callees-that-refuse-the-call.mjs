let reads = 0, caught = 0, names = "";
class Crate { constructor() {} }
const descriptor = { get() { reads++; return 1; } };
function makeList() {
  const list = [1, 2];
  Object.defineProperty(list, 0, descriptor);
  return list;
}
function ofClass() { try { Crate.apply(null, makeList()); } catch (error) { caught++; names = error.constructor.name; } }
function ofNothing(callee) { try { Reflect.apply(callee, null, makeList()); } catch (error) { caught++; names = error.constructor.name; } }
for (let i = 0; i < 300; i++) ofClass();
console.log(reads, caught, names);
for (let i = 0; i < 300; i++) ofNothing(i % 2 ? undefined : {});
console.log(reads, caught, names);
