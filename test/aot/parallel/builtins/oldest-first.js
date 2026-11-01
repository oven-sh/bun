// The oldest entry of a Map or Set goes first, as from a cache or a queue: a walk from the front, then the deletion.
// A walk from the front begins behind the entries that are known to be deleted there. What is known ends with the table: replaced, let go, cleared.
// STATISTIC: StepsThatKnowTheDeletedPrefix >= 4
const lines = [];
const name = v => (v === undefined ? "undefined" : typeof v === "object" ? "o" + v.i : String(v));
const kinds = { text: i => "k" + i, whole: i => i, half: i => i + 0.5, object: (objects => i => (objects[i] ??= { i }))([]) };

for (const [kind, key] of Object.entries(kinds)) {
  for (const size of [1, 3, 8, 9, 40, 200]) {
    // A cache at a steady size, through many tables, with iterators that stand among the deleted entries.
    const map = new Map(), set = new Set();
    let next = 0;
    for (; next < size; next++) { map.set(key(next), next); set.add(key(next)); }
    const held = [map.keys(), map.entries(), set.values(), set[Symbol.iterator](), map.keys()];
    held[1].next();
    for (let i = 0; i < size >> 1; i++) held[2].next();
    const seen = [];
    for (let turn = 0; turn < 3 * size + 5; turn++, next++) {
      map.set(key(next), next); set.add(key(next));
      const oldest = map.keys().next().value;
      map.delete(oldest);
      const [first] = set;
      set.delete(first);
      seen.push(name(oldest) === name(first) ? name(first) : "DIFFER");
      if (turn % 4 === 1) { const touched = key(next - (size >> 1)); if (map.delete(touched)) map.set(touched, -1); }
      if (turn % 5 === 2) { const r = held[turn % 4].next(); seen.push(r.done ? "done" : name(Array.isArray(r.value) ? r.value[0] : r.value)); }
    }
    lines.push([kind, size, seen.join(), [...held[4]].map(name).join(), map.size, set.size, [...map.keys()].map(name).join(), [...set].map(name).join()].join(" | "));

    // Down to nothing from the front, a walk over nothing, and up again: in the same table, behind clear(), behind clear() of a table that nobody has found an entry in.
    for (const between of ["nothing", "clear", "walk and clear"]) {
      const m = new Map(), s = new Set();
      for (let i = 0; i < size; i++) { m.set(key(i), i); s.add(key(i)); }
      if (between === "walk and clear") { for (let i = 0; i < size; i++) { m.delete(key(i)); s.delete(key(i)); } }
      else { while (m.size) m.delete(m.keys().next().value); while (s.size) s.delete(s.values().next().value); }
      let count = 0;
      for (const _ of m) count++;
      for (const _ of s) count++;
      count += m.keys().next().done ? 0 : 100;
      count += s.values().next().done ? 0 : 100;
      if (between !== "nothing") { m.clear(); s.clear(); }
      for (let i = 0; i < 3; i++) { m.set(key(size + i), i); s.add(key(size + i)); }
      lines.push([between, count, name(m.keys().next().value), name(s.values().next().value), [...m.keys()].map(name).join(), [...s].map(name).join(), name([...m][0][0])].join(" | "));
      // What was known of the table in front of clear() says nothing of the entries behind it.
      m.delete(m.keys().next().value); s.delete(s.values().next().value);
      let left = 0;
      for (const _ of m) left++;
      for (const _ of s) left++;
      lines.push([left, name(m.keys().next().value), name(s.values().next().value), [...m.keys()].map(name).join(), [...s].map(name).join()].join(" | "));
    }

    // A copy begins anew, and so does what is left when most has gone.
    const source = new Set();
    for (let i = 0; i < size + 4; i++) source.add(key(i));
    for (let i = 0; i < 3; i++) source.delete(source.values().next().value);
    const copy = new Set(source), union = source.union(new Set([key(0)]));
    lines.push([name(copy.values().next().value), name(union.values().next().value), copy.size, union.size, name(source.values().next().value)].join(" | "));
  }
}
console.log(lines.join("\n"));
