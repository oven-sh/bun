// Each export is made by a call that nobody can tell the time of. Some are read as the bindings they are, some out of the namespace object, which the functions of the file get as `this`.
import * as all from "./barrel.js";

function read(holder) {
  return holder.besideAnother;
}

console.log(all.look().name, all.look()(), all.look() === all.looked);
console.log(all.test(), all.missing());
console.log(read({ besideAnother: () => "own" })(), read(all).name, read(all)());
console.log(all.self() === all, typeof all.self(), all.self().throughSelf.name, all.self().throughSelf());
console.log(all.direct.name, all.direct.kind, all.direct(), all.direct === all.direct);
setTimeout(() => console.log(all.late.name, all.late(), all.tested()), 0);
