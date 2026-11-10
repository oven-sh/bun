// One site, every kind of receiver: lists that the stub serves, lists that it leaves early and late, what is no list as made. The door is read under a key, so the list is out of sight at the site.
// COUNT: operation:operationAOTArraySpliceItemIntoAnyList <= 215
const doors = { into(list, place, item) { list.splice(place(list), 0, item); } };
const [OUT, INTO] = JSON.parse('["out","into"]');
const go = (door, ...rest) => doors[door](...rest);

const makes = {
  cells: () => [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
  wholes: () => [1, 2, 3, 4],
  fractions: () => [1.5, 2.5, 3.5, 4.5],
  texts: () => ["a", "b", "c", "d"],
  thirtyThree: () => Array.from({ length: 33 }, (_, i) => "t" + i),
  thirtyFour: () => Array.from({ length: 34 }, (_, i) => "t" + i),
  long: () => Array.from({ length: 40 }, (_, i) => i),
  one: () => [7],
  none: () => [],
  own: () => ({ length: 0, splice(...all) { console.log("SAID its own splice takes", JSON.stringify(all), this.length); return "own"; } }),
  heir: () => new (class Heir extends Array { constructor(...all) { super(...all); console.log("SAID an heir is made of", JSON.stringify(all)); } })(1, 2, 3),
  frozen: () => Object.freeze([1, 2, 3]),
  named: () => Object.assign([1, 2, 3], { note: "kept" }),
};

for (let turn = 0; turn < 3; turn++)
  for (const kind of Object.keys(makes))
    for (const at of [0, 1, 3, -1, -2, -9, 9]) {
      const list = makes[kind]();
      try { go(INTO, list, () => at, kind === "wholes" && turn ? 50 + turn : { came: turn }); console.log("SAID", kind, at, JSON.stringify(list), list.length); } catch (error) { console.log("SAID", kind, at, error.name, JSON.stringify(list), list.length); }
    }
