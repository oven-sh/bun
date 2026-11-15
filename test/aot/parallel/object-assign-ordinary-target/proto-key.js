// An own key "__proto__" of the source goes through the setter of Object.prototype and changes the target's prototype.
const proto = { kind: "p" };
const other = { kind: "other" };
for (let round = 0; round < 5; round++) {
  const computed = { alpha: 1, ["__proto__"]: other, beta: 2 };
  const parsed = JSON.parse('{"alpha":1,"__proto__":{"kind":"parsed"},"beta":2}');
  for (const source of [computed, parsed]) {
    const made = Object.assign(Object.create(proto), source);
    console.log(round, Object.keys(made).join(), made.kind, Object.getPrototypeOf(made) === proto, Object.hasOwn(made, "__proto__"));
  }
  const bare = Object.assign(Object.create(null), computed);
  console.log(round, Object.keys(bare).join(), Object.getPrototypeOf(bare) === null, Object.hasOwn(bare, "__proto__"));
}
