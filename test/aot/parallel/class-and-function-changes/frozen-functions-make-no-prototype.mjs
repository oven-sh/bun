import { heapStats } from "bun:jsc";
const count = 3000;
const made = [];
for (let i = 0; i < count; i++)
  made.push(function (x) {
    return x + i;
  });
const plainObjects = () => {
  Bun.gc(true);
  return heapStats().objectTypeCounts.Object ?? 0;
};
const before = plainObjects();
for (const f of made) Object.freeze(f);
const madeByFreezing = plainObjects() - before;
console.log(made.every(Object.isFrozen), madeByFreezing < count / 10 ? "few" : madeByFreezing);
const prototypes = made.map(f => f.prototype);
console.log(
  prototypes.every((prototype, i) => prototype.constructor === made[i]),
  plainObjects() - before >= count,
  made[5](1),
);

/* Output:
true few
true true 6
*/
