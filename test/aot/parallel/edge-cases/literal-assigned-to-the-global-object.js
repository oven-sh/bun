// Object.assign with a literal that the call spells out stores under the names of the literal, through the setters that lie there, and leaves every other global what it was.
Object.defineProperty(globalThis, "watched", { set(value) { console.log("setter", value); }, get() { return "getter"; }, configurable: true });
const returned = Object.assign(globalThis, { assignedName: 7, assignedFunction: () => 8, watched: 9, [Symbol.for("assigned")]: 10, 5: "index" });
console.log(returned === globalThis, assignedName, assignedFunction(), watched, globalThis[Symbol.for("assigned")], globalThis[5]);
console.log(typeof Date.now(), typeof Buffer.from, Math.floor(1.5));

Object.assign(Date, { now: () => 11 }, { parse: () => 12 });
console.log(Date.now(), Date.parse("x"), typeof Date.UTC(2000, 0));

const kept = { laterName: 13 };
kept.addedName = 14;
Object.assign(globalThis, kept);
console.log(laterName, addedName);
