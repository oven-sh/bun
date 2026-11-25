// The object is an object like any other: it is stored into, added to, deleted from and frozen, and every read sees it.
var Marks;
(function (Marks) {
    Marks[Marks["End"] = -1] = "End";
    Marks[Marks["Start"] = 0] = "Start";
    Marks[Marks["Middle"] = 7] = "Middle";
})(Marks || (Marks = {}));
function kind(c) {
  switch (c) {
    case Marks.End: return "end";
    case Marks.Start: return "start";
    case Marks.Middle: return "middle";
    default: return "other";
  }
}
function all() { return [kind(-1), kind(0), kind(7), kind(8), kind("x"), kind(undefined)].join(); }
console.log(all());
for (let i = 0; i < 3000; i++) all();
Marks.Middle = 8;
console.log(all(), Marks[7], Marks[8]);
Marks["End"] = "x";
console.log(all());
delete Marks.Start;
console.log(all(), Object.keys(Marks).join());
Marks.Later = 0;
Marks[-1] = "again";
console.log(all(), Object.keys(Marks).join(), Marks[-1]);
Object.defineProperty(Marks, "Start", { get() { return 7; }, configurable: true, enumerable: true });
console.log(all(), Object.keys(Marks).join());
Object.freeze(Marks);
try { Marks.Middle = 1; } catch (error) { console.log(error instanceof TypeError); }
console.log(all(), Object.isFrozen(Marks));
