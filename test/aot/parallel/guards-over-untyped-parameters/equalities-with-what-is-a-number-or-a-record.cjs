// A parameter that is a number in one call and a record in the next is held against the fields of rows, in loops over maps, lists and views, from both sides, kept and branched on.
const rows = new Map(), list = [], bytes = new Uint8Array(12), keys = [{ min: 1 }, { min: 2 }, 3, 0, -0, NaN, "3", null, undefined, true, 3n, 1.5];
for (let id = 0; id < 12; id++) { const row = { id, owner: id % 3 ? id % 4 : keys[id % keys.length], size: id * 7 % 10 }; rows.set(id, row); list.push(row); bytes[id] = id % 4; }
const ways = {
  map(owner) { let n = 0; for (const row of rows.values()) if (row.owner === owner) n += row.id; return n; },
  list(owner) { let n = 0; for (const row of list) if (owner === row.owner) n += row.id; return n; },
  loose(owner) { let n = 0; for (const row of list) if (row.owner == owner) n += row.id; return n; },
  kept(owner) { let last = false; for (const row of list) last = row.owner === owner; return last; },
  bytes(owner) { let n = 0; for (let i = 0; i < bytes.length; i++) if (bytes[i] === owner) n += i; return n; },
  beside(owner) { let n = 0; for (const row of list) if (row.owner === owner && (!owner || owner.min === undefined || row.size >= owner.min)) n += row.id; return n; },
  changed(owner) { let n = 0; for (const row of list) { if (row.owner === owner) n += row.id; if (row.id === 5) owner = { min: 9 }; } return n; },
};
function through(read) { return function () { return read.apply(this, Array.prototype.slice.call(arguments)); }; }
const wrapped = Object.keys(ways).map(name => through(ways[name]));
const out = [];
for (let turn = 0; turn < 30; turn++) {
  out.length = 0;
  for (const read of wrapped) for (const key of keys) out.push(read(key), read(key, { min: 5 }));
}
console.log(out.length, out.join());
