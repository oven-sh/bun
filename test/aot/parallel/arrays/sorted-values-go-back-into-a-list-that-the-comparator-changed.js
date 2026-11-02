// sort() writes the sorted values back with one look at the list's storage. The comparator may have changed that storage, the length or the list's locks.
function show(label, list) {
  const parts = [];
  for (let i = 0; i < list.length; i++)
    parts.push(
      i in list ? (typeof list[i] === "object" && list[i] !== null ? "{" + list[i].k + "}" : String(list[i])) : "-",
    );
  console.log(label, list.length, parts.join(" "));
}
function attempt(label, make, change) {
  for (let at = 0; at < 6; at++) {
    const list = make();
    let calls = 0;
    try {
      const result = list.sort((a, b) => {
        if (calls++ === at) change(list);
        const x = typeof a === "object" ? a.k : a;
        const y = typeof b === "object" ? b.k : b;
        return (x % 10) - (y % 10);
      });
      show(label + " " + at + (result === list ? "" : " another list"), list);
    } catch (error) {
      show(label + " " + at + " " + error.constructor.name, list);
    }
  }
}
const makers = {
  integers: () => [15, 3, 22, 9, 41, 7],
  pushed: () => {
    const list = [];
    for (let i = 0; i < 6; i++) list.push((i * 7 + 3) % 11);
    return list;
  },
  fractions: () => [15.5, 3.25, 22.5, 9.75, 41.5, 7.125],
  fractionsWithHole: () => [15.5, 3.25, , 9.75, 41.5, 7.125],
  fractionsWithNaN: () => [15.5, 3.25, NaN, 9.75, 41.5, 7.125],
  objects: () => [{ k: 5 }, { k: 3 }, { k: 12 }, { k: 9 }, { k: 1 }],
  mixed: () => [{ k: 5 }, 3, { k: 12 }, 9, 1],
  withUndefined: () => [4, undefined, 2, undefined, 13, 1],
  withHoles: () => [4, , 2, , 13, 1],
  long: () => Array.from({ length: 20 }, (_, i) => ({ k: (i * 13) % 17 })),
};
const changes = {
  nothing: () => {},
  fraction: list => {
    list[1] = 0.5;
  },
  object: list => {
    list[1] = { k: 100 };
  },
  text: list => {
    list[0] = "7";
  },
  shorter: list => {
    list.length = 1;
  },
  empty: list => {
    list.length = 0;
  },
  longer: list => {
    list.push(8, 6);
  },
  far: list => {
    list[5000] = 2;
  },
  hole: list => {
    delete list[2];
  },
  frozen: list => {
    Object.freeze(list);
  },
  sealed: list => {
    Object.seal(list);
  },
  closed: list => {
    Object.preventExtensions(list);
  },
  readOnly: list => {
    Object.defineProperty(list, 1, { value: 77, writable: false });
  },
  setter: list => {
    Object.defineProperty(list, 2, {
      set(v) {
        console.log("set", typeof v === "object" ? v.k : v);
      },
      get() {
        return 6;
      },
      configurable: true,
    });
  },
  fixedLength: list => {
    Object.defineProperty(list, "length", { writable: false });
  },
  shifted: list => {
    list.shift();
  },
  unshifted: list => {
    list.unshift(30);
  },
  reversed: list => {
    list.reverse();
  },
  filled: list => {
    list.fill(1.25);
  },
};
for (const [kind, make] of Object.entries(makers))
  for (const [what, change] of Object.entries(changes)) attempt(kind + " " + what, make, change);

// The same literal again and again: its storage is shared until the first store.
function literal(i) {
  const list = [9, 4, 7, 1];
  list.sort((a, b) => (a & 7) - (b & 7) + (i & 0));
  return list.join();
}
console.log(literal(0), literal(1), literal(2));
