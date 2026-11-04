// Object.assign into a literal throws in a getter of a later source: whoever catches that finds the literal with what the earlier sources have brought, and without what the later ones would have.
function deed(i, hostile) {
  let target;
  try {
    target = { c: 1 };
    Object.assign(target, { a: i }, hostile, { z: 9 });
  } catch (e) {
    return e.name + " " + JSON.stringify(target);
  }
  return JSON.stringify(target);
}
const throwing = () => ({
  early: 1,
  get boom() {
    throw new RangeError("half way");
  },
  late: 2,
});
console.log(deed(1, { m: 0 }));
console.log(deed(2, throwing()));
let last = "";
for (let i = 0; i < 300; i++) last = deed(i, i % 2 ? throwing() : undefined);
console.log(last);
