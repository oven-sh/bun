// An object that got names its literal does not list keeps them in a second object. A spread copies both without a call into the run time, once the source has been copied before.
// COUNT: operation:operationAOTCopyObject <= 1800
function filled(count, seed) {
  const made = {};
  for (let i = 0; i < count; i++) made["k" + i] = seed + i;
  return made;
}
function grown(count, seed) {
  const made = { first: seed, second: "two" };
  for (let i = 0; i < count; i++) made["late" + i] = i % 3 ? seed * i : "text" + i;
  return made;
}
const copy = o => ({ ...o });
const withOne = (o, v) => ({ ...o, extra: v });
const show = o => JSON.stringify(o) + "|" + Object.keys(o).length;
let hash = 0;
const mix = text => {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
};

// Every length of the storage: none, in the cell, and outside it up to where the stub gives up.
const sources = [];
for (let count = 0; count <= 24; count++) sources.push(filled(count, count * 100), grown(count, count + 1));
for (let round = 0; round < 60; round++) {
  for (const source of sources) {
    const once = copy(source);
    const twice = copy(once);
    const more = withOne(twice, round);
    if (round % 20 === 0) mix(show(once) + show(twice) + show(more));
    // A copy has storage of its own.
    twice.k0 = -1;
    twice.late0 = -2;
    twice.added = round;
    delete more.k1;
    if (round % 20 === 0) mix(show(source) + show(once) + show(twice) + show(more));
  }
}
console.log(hash, show(sources[9]), show(copy(sources[10])), show(withOne(sources[40], 1)));

// Sources that are not copied word by word.
const symbol = Symbol("s");
const odd = {
  frozen: Object.freeze(filled(5, 1)),
  sealed: Object.seal(grown(3, 2)),
  closed: Object.preventExtensions(filled(3, 3)),
  withSymbol: Object.assign(filled(3, 4), { [symbol]: 1 }),
  withIndex: Object.assign(filled(3, 5), { 7: "seven", 2: "two" }),
  withGetter: Object.defineProperty(filled(3, 6), "got", { get() { return this.k0 + 1; }, enumerable: true }),
  withHidden: Object.defineProperty(filled(3, 7), "hidden", { value: 1, enumerable: false }),
  withReadOnly: Object.defineProperty(filled(3, 8), "fixed", { value: 1, enumerable: true, writable: false }),
  withDeleted: (() => { const made = filled(6, 9); delete made.k2; delete made.k5; made.k2 = "again"; return made; })(),
  withProto: Object.setPrototypeOf(filled(3, 10), { inherited: 1 }),
  asProto: (() => { const made = filled(3, 11); Object.create(made); return made; })(),
  many: filled(100, 12),
};
for (const name in odd) {
  let made;
  for (let i = 0; i < 5; i++) made = copy(odd[name]);
  made.k0 = "changed";
  made.fresh = 1;
  console.log(name, show(made).length, Object.keys(made).join().length, Object.isFrozen(made), Object.isExtensible(made), Object.getOwnPropertySymbols(made).length,
    Object.getPrototypeOf(made) === Object.prototype, JSON.stringify(Object.getOwnPropertyDescriptor(made, "fixed") ?? Object.getOwnPropertyDescriptor(made, "got") ?? null), odd[name].k0);
}

// Copies live on when their sources are gone, and the other way round.
let chain = filled(7, 1);
const keptCopies = [];
for (let i = 0; i < 20000; i++) {
  chain = copy(chain);
  chain.k3 = i;
  if (i % 4000 === 0) keptCopies.push(chain);
}
console.log(show(chain), keptCopies.map(each => each.k3).join());
