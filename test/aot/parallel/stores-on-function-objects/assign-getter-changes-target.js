// A getter of an Object.assign source changes the target function object midway: its prototype, its integrity, one of its properties.
const log = [];
const Kind = { tag: "kind" };
const Trap = { tag: "trap", set late(value) { log.push("setter late " + value); } };
for (let round = 0; round < 4; round++) {
  function Moved() {}
  Object.setPrototypeOf(Moved, Kind);
  Object.assign(Moved, { early: 1, get middle() { Object.setPrototypeOf(Moved, Trap); return 2; }, late: 3 });
  log.push("moved " + Object.keys(Moved) + " " + Object.getPrototypeOf(Moved).tag);
  function Closed() {}
  Object.setPrototypeOf(Closed, Kind);
  try { Object.assign(Closed, { early: 1, get middle() { Object.preventExtensions(Closed); return 2; }, late: 3 }); log.push("closed did not throw"); }
  catch (error) { log.push("closed " + error.name + " " + Object.keys(Closed)); }
  function Fixed() {}
  Object.setPrototypeOf(Fixed, Kind);
  try { Object.assign(Fixed, { early: 1, get middle() { Object.defineProperty(Fixed, "late", { value: "fixed", writable: false, enumerable: true }); return 2; }, late: 3 }); log.push("fixed did not throw"); }
  catch (error) { log.push("fixed " + error.name + " " + Object.keys(Fixed) + " " + Fixed.late); }
}
console.log(log.join("\n"));
