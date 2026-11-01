// Symbol corners: compiled answers as plain.
const s = Symbol("d"),
  t = g => {
    try {
      return String(g());
    } catch (e) {
      return e.constructor.name;
    }
  };
console.log(
  t(() => s.description),
  t(() => s + ""),
  t(() => `${s}`),
  t(() => String(s)),
  t(() => +s),
  t(() => Symbol.for("a") === Symbol.for("a")),
  t(() => Symbol("a") === Symbol("a")),
  t(() => Symbol.keyFor(Symbol.for("k"))),
  t(() => Symbol.keyFor(s)),
  t(() => typeof Object(s)),
  t(() => ({ [s]: 1 })[s]),
  t(() => JSON.stringify({ [s]: 1 })),
  t(() => Object.keys({ [s]: 1 }).length),
  t(() => s.toString()),
  t(() => !!s),
  t(() => new Symbol()),
);
