// Objects are created below a literal in the declaration of the literal too.
const first = { m() { return this.v ?? "none"; } }, made = Object.create(first), second = { twice() { return this.v * 2; } }, v = made.m(), other = Object.create(second), last = { n() { return 4; } };
const out = [made.m(), v, Object.getPrototypeOf(made) === Object.getPrototypeOf(Object.create(first))];
other.v = made.v = 8;
out.push(other.twice(), made.m(), Object.create(last).n(), Object.keys(Object.getPrototypeOf(other)).join());
let early;
try {
  early = Object.create(late);
} catch (error) {
  early = error.message;
}
const late = { o() { return 5; } }, behind = Object.create(late).o();
out.push(early, behind);
console.log(out.join("\n"));
