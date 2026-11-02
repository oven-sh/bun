// Spreads and Object.assign out of objects that are frozen, sealed or not extensible: the copy has the enumerable own properties of the source in their order, and none of its integrity. Each copy repeats.
function Made() { this.a = 1; }
function copiesOfClosedSources() {
  const key = Symbol("key");
  const makers = [
    () => ({ a: 1, b: "x", c: true }),
    () => { const o = { a: 1, b: "x" }; o["late" + 1] = 2; o.later = 3; return o; },
    () => ({ a: 1, [key]: 2, b: 3 }),
    () => { const o = { a: 1, b: 2 }; Object.defineProperty(o, "hidden", { value: 3, enumerable: false }); return o; },
    () => { const o = { a: 1, b: 2 }; Object.defineProperty(o, "b", { get() { return 9; }, enumerable: true }); return o; },
    () => { const o = new Made(); o.extra = 1; return o; },
    () => { const o = { a: 1, b: 2, c: 3 }; delete o.b; return o; },
    () => { const o = { a: 1 }; o[0] = "zero"; o[1] = "one"; return o; },
  ];
  const close = [o => o, Object.preventExtensions, Object.seal, Object.freeze];
  const lines = [];
  for (const make of makers) {
    for (const closeIt of close) {
      for (let turn = 0; turn < 3; turn++) {
        const source = closeIt(make());
        const spread = { port: turn, ...source };
        const assigned = Object.assign({ port: turn, a: 0 }, source);
        const first = { ...source, port: turn };
        spread.a = 50;
        assigned.fresh = 1;
        if (turn === 2) lines.push([spread, assigned, first].map(o => JSON.stringify(o) + Object.getOwnPropertySymbols(o).length + Object.isFrozen(o) + Object.isExtensible(o)).join(" "));
      }
    }
  }
  return lines.join("\n");
}
console.log(copiesOfClosedSources());
