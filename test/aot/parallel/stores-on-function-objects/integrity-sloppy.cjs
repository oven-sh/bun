// A frozen, sealed or non-extensible function object refuses new properties, and a frozen one new values: silently in sloppy code. Object.assign always throws.
const log = [];
const Kind = { tag: "kind" };
function store(target, key, value) { target[key] = value; }
for (let round = 0; round < 4; round++) {
  for (const [label, close] of [["frozen", Object.freeze], ["sealed", Object.seal], ["closed", Object.preventExtensions], ["open", value => value]]) {
    for (const below of [false, true]) {
      function Made() {}
      if (below) Object.setPrototypeOf(Made, Kind);
      Made.old = 1;
      close(Made);
      for (const key of ["old", "fresh"]) {
        try { store(Made, key, round + 2); log.push([label, below, key, Made[key]].join(" ")); }
        catch (error) { log.push([label, below, key, error.name, Made[key]].join(" ")); }
      }
      try { Object.assign(Made, { old: 9, more: 9 }); log.push(label + " assigned " + Object.keys(Made)); }
      catch (error) { log.push(label + " assign " + error.name + " " + Object.keys(Made) + " " + Made.old); }
    }
  }
}
console.log(log.join("\n"));
