// A class may stamp a private method or field on any object its base constructor returns. A spread copies own properties and leaves the private names behind, whichever way it copies.
class Base {
  constructor(object) {
    return object;
  }
}
class Branded extends Base {
  #method() {}
  static has(object) {
    return #method in object;
  }
}
class WithField extends Base {
  #field = 1;
  static has(object) {
    return #field in object;
  }
}
function fill(count, first, step, into) {
  for (let i = 0; i < count; i++) into[first + i * step] = i;
  return into;
}
function names(count, into) {
  for (let i = 0; i < count; i++) into["id" + i] = i;
  return into;
}
const kinds = {
  empty: () => ({}),
  "a few names": () => names(3, {}),
  "a large dictionary": () => names(300, {}),
  "a dictionary with a hole": () => {
    const made = names(300, {});
    delete made.id5;
    return made;
  },
  elements: () => fill(10, 0, 1, {}),
  "elements of fractions": () => fill(10, 0.5, 0, {}),
  "sparse elements": () => fill(10, 1000, 7, {}),
  "elements and names": () => fill(10, 1000, 7, names(3, {})),
  "elements and a large dictionary": () => fill(10, 0, 1, names(300, {})),
};
for (const [kind, make] of Object.entries(kinds)) {
  for (const Class of [Branded, WithField]) {
    for (let round = 0; round < 3; round++) {
      const source = make();
      new Class(source);
      const copy = { ...source };
      const again = { ...copy };
      console.log(kind, Class.name, Class.has(source), Class.has(copy), Class.has(again), Object.keys(copy).length, Object.keys(again).length);
      if (round === 2) {
        copy.added = 1;
        new Class(copy);
        console.log(kind, Class.name, "stamped", Class.has(copy), Class.has({ ...copy }));
      }
    }
  }
}
