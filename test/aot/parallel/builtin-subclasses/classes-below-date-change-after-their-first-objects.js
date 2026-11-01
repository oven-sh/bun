// A class below Date whose prototype, parent or own objects change after objects were made: JSON.stringify and getTime follow what the program did, and Error.isError asks the object where a class has lost Error as its parent.
const say = (name, run) => { let said; try { said = String(run()); } catch (error) { said = "throws " + error.name; } console.log(name + ": " + said); };
class Stamp extends Date {}
class Grown extends Date {}
class Moved extends Date {}
class Reparented extends Date {}
class Other {}
class Returns extends Date { constructor(t) { super(t); return { toJSON() { return "returned"; } }; } }
function writeDates(dates) { return JSON.stringify(dates); }
function times(dates) { return dates.map(d => d.getTime()).join(); }
function isErr(e) { return Error.isError(e); }
function getOf(m) { return m.get(1); }
class Failure extends Error {}
class NotFailure extends Error {}
class Counted extends Map {}
const lists = () => [new Date(1), new Stamp(2), new Grown(3), new Moved(4), new Reparented(5), new Returns(6)];
say("before", () => writeDates(lists()));
Grown.prototype.toJSON = function () { return "grown"; };
say("grown", () => writeDates(lists()));
Object.setPrototypeOf(Moved.prototype, { toJSON() { return "moved"; } });
say("moved", () => writeDates(lists()));
Object.setPrototypeOf(Reparented, Other);
say("reparented", () => writeDates(lists()));
say("reparented times", () => times([new Date(1), new Stamp(2)]));
const own = new Stamp(9); own.toJSON = () => "own";
say("own", () => writeDates([own, new Date(1)]));
Stamp.prototype.getTime = () => 77;
say("getTime", () => times([new Date(1), new Stamp(2)]));
say("isErr", () => [isErr(new Failure("a")), isErr(new Error("b")), isErr({})].join());
Object.setPrototypeOf(NotFailure, Object);
say("not failure", () => { const e = new NotFailure("x"); return [isErr(e), e instanceof Error].join(); });
Counted.prototype.get = () => "counted";
say("get", () => [getOf(new Map([[1, 2]])), getOf(new Counted([[1, 2]]))].join());
