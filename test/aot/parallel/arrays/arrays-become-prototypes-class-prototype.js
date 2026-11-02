// A class prototype with an array below it gets a setter under an index. Then arrays and objects with elements of every kind become prototypes, by every way of making an heir, and are made longer and shorter, read, stored into, pushed to, spliced, sorted and filled, alone and through their heirs.
const log = [];
class Above {}
const below = Object.setPrototypeOf([1, 2], Above.prototype);
Object.defineProperty(Above.prototype, 3, {
  set(value) {
    log.push(["Above", Array.isArray(this), value]);
  },
  configurable: true,
});
below[3] = "below";

const show = (label, ...values) => console.log(label, JSON.stringify(values));
function store(object, index, value) {
  try {
    object[index] = value;
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
const kinds = {
  integers: () => [1, 2, 3],
  fractions: () => [1.5, 2.5, 3.5],
  strings: () => ["a", "b", "c"],
  empty: () => [],
  reserved: () => new Array(3),
  holes: () => [1, , 3],
  pushed: () => {
    const list = [];
    for (let i = 0; i < 3; i++) list.push(i);
    return list;
  },
  record: () => ({ 0: "zero", 1: "one", 2: "two", length: 3 }),
};
const heirs = {
  setPrototypeOf: prototype => Object.setPrototypeOf({}, prototype),
  create: prototype => Object.create(prototype),
  literal: prototype => ({ __proto__: prototype }),
  constructor: prototype => {
    function Made() {}
    Made.prototype = prototype;
    return new Made();
  },
  construct: prototype => {
    function Target() {}
    Target.prototype = prototype;
    return Reflect.construct(Array, [7, 8], Target);
  },
  array: prototype => Object.setPrototypeOf([7, 8], prototype),
};

for (const [kind, make] of Object.entries(kinds)) {
  for (const [way, inherit] of Object.entries(heirs)) {
    const prototype = make();
    const heir = inherit(prototype);
    const label = kind + " " + way;
    show(label + " read", heir[0], heir[1], heir[2], heir[3], heir.length, 1 in heir, Object.keys(heir));
    prototype.length = 100_000;
    show(label + " longer", prototype.length, prototype[0], prototype[2], prototype[3], prototype[99_999], heir[2]);
    prototype[99_998] = "far";
    show(label + " far", heir[99_998], Object.keys(prototype).length);
    prototype.length = 2;
    show(label + " shorter", prototype.length, prototype[1], prototype[2], heir[2], heir[99_998]);
    heir[1] = "own";
    heir[5] = "own too";
    show(label + " stored", heir[1], prototype[1], heir[5], prototype[5], Object.keys(heir));
  }
}

for (const [kind, make] of Object.entries(kinds)) {
  if (kind === "record") continue;
  const prototype = make();
  const heir = Object.create(prototype);
  show(kind + " push", prototype.push(9, 8), heir[prototype.length - 1]);
  show(kind + " unshift", prototype.unshift(0), heir[0], prototype);
  show(kind + " splice", prototype.splice(1, 1, "x", "y"), prototype, heir[1]);
  show(kind + " sort", prototype.sort(), heir[0]);
  show(kind + " reverse", prototype.reverse(), heir[0]);
  show(kind + " fill", prototype.fill(4, 1, 3), heir[1]);
  show(kind + " copyWithin", prototype.copyWithin(0, 2), heir[0]);
  show(kind + " pop shift", prototype.pop(), prototype.shift(), prototype.length, heir.length);
  show(
    kind + " concat",
    [].concat(prototype, [1]).length,
    prototype.slice(1).length,
    prototype.map(value => value).length,
  );
  show(kind + " push on the heir", Array.prototype.push.call(heir, "last"), Object.keys(heir), prototype.length);
  prototype[prototype.length + 2] = "past a hole";
  show(kind + " hole", prototype, heir[prototype.length - 2], heir[prototype.length - 1]);
}

for (const [kind, make] of Object.entries(kinds)) {
  const prototype = make();
  const heir = Object.create(prototype);
  const list = Object.setPrototypeOf(["first"], prototype);
  Object.setPrototypeOf(prototype, Above.prototype);
  prototype[3] = kind + " prototype";
  heir[3] = kind + " heir";
  list[3] = kind + " list";
  show(
    kind + " below the setter",
    3 in prototype,
    Object.hasOwn(prototype, 3),
    Object.hasOwn(heir, 3),
    Object.hasOwn(list, 3),
    list.length,
  );
  Object.defineProperty(prototype, 4, {
    get() {
      return "got";
    },
    set(value) {
      log.push([kind, this === heir, this === list, value]);
    },
  });
  heir[4] = "four";
  list[4] = "four";
  prototype[4] = "four";
  show(
    kind + " own accessor",
    heir[4],
    list[4],
    prototype[4],
    Object.hasOwn(heir, 4),
    Object.hasOwn(list, 4),
    list.length,
  );
  Object.defineProperty(prototype, 6, { value: "fixed", writable: false });
  show(
    kind + " constant",
    store(heir, 6, "six"),
    store(list, 6, "six"),
    heir[6],
    list[6],
    Object.hasOwn(heir, 6),
    Object.hasOwn(list, 6),
  );
}

for (const [kind, make] of Object.entries(kinds)) {
  const frozen = Object.freeze(make());
  const sealed = Object.seal(make());
  const heirs = [Object.create(frozen), Object.create(sealed)];
  show(
    kind + " over frozen",
    store(heirs[0], 0, "over"),
    store(heirs[0], 9, "new"),
    store(frozen, 0, "changed"),
    store(frozen, 9, "new"),
  );
  show(
    kind + " over sealed",
    store(heirs[1], 0, "over"),
    store(heirs[1], 9, "new"),
    store(sealed, 0, "changed"),
    store(sealed, 9, "new"),
  );
  show(
    kind + " frozen and sealed",
    heirs[0][0],
    heirs[1][0],
    heirs[0][9],
    heirs[1][9],
    sealed[0],
    sealed[9],
    Object.keys(heirs[0]),
    Object.keys(heirs[1]),
  );
}

(function () {
  const heir = Object.create(arguments);
  arguments.length = 100_000;
  arguments[50_000] = "far";
  show("arguments", heir[0], heir[1], heir[50_000], heir.length);
})("a", "b");

function sumAroundAnHeir() {
  const list = [1, 2, 3];
  let sum = list[0];
  const heir = Object.create(list);
  sum += list[1];
  list[2] = 10;
  sum += list[2] + heir[2];
  list.push(4);
  return sum + list.length + heir[3];
}
function sumWhileAnHeirIsMade(list) {
  let sum = 0;
  let heir = null;
  for (let i = 0; i < list.length; i++) {
    if (i === 2) heir = Object.setPrototypeOf({}, list);
    sum += list[i];
    list[i] = sum;
    if (heir) sum += heir[i];
  }
  return sum;
}
function fillWhileAnHeirIsMade(length) {
  const list = [];
  let heir = null;
  for (let i = 0; i < length; i++) {
    if (i === 3) heir = { __proto__: list };
    list[i] = i * 0.5;
  }
  return [list.length, list[length - 1], heir[length - 1], heir.length];
}
for (let i = 0; i < 3; i++) {
  show(
    "between reads and stores",
    sumAroundAnHeir(),
    sumWhileAnHeirIsMade([1, 2, 3, 4, 5]),
    sumWhileAnHeirIsMade([0.5, 1.5, 2.5, 3.5]),
    sumWhileAnHeirIsMade(["a", "b", "c", "d"]),
    fillWhileAnHeirIsMade(8),
  );
}

const ordinary = [1, 2, 3];
ordinary[3] = 4;
ordinary.length = 100_000;
show("an ordinary array", ordinary.length, ordinary[3]);
console.log(JSON.stringify(log));
