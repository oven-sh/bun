// The setter lies on the prototype object of a class and reads a member of what it takes. The source of Object.assign has got that object by a spread.
const more = { b: { k: 1 } };
class Target {
  set b(x) {
    console.log("b", typeof x, x.k);
  }
}
Object.assign(new Target(), { a: 1, ...more });
