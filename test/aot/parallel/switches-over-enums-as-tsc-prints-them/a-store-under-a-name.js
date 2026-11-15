// A store under the name of a member, in the same file.
var Marks;
(function (Marks) {
    Marks[Marks["End"] = -1] = "End";
    Marks[Marks["Start"] = 0] = "Start";
    Marks[Marks["Middle"] = 7] = "Middle";
    Marks[Marks["Last"] = 9] = "Last";
})(Marks || (Marks = {}));
function kind(c) {
  switch (c) {
    case Marks.End: return "end";
    case Marks.Start: return "start";
    case Marks.Middle: return "middle";
    case Marks.Last: return "last";
    default: return "other";
  }
}
function all() { return [kind(-1), kind(0), kind(-0), kind(7), kind(9), kind(5), kind("7"), kind(undefined), kind(7.5), kind(NaN)].join(); }
console.log(all());
for (let i = 0; i < 3000; i++) all();
function change() { Marks.Middle = 5; }
change();
console.log(all(), Object.keys(Marks).join());
