// The function is called above the statement that makes the object: the first label throws, whatever the subject is.
function kind(c) {
  switch (c) {
    case Marks.End: return "end";
    case Marks.Start: return "start";
    default: return "other";
  }
}
function tried(c) { try { return kind(c); } catch (error) { return error instanceof TypeError ? "TypeError" : String(error); } }
console.log(tried(-1), tried(0), tried(5));
var Marks;
(function (Marks) {
    Marks[Marks["End"] = -1] = "End";
    Marks[Marks["Start"] = 0] = "Start";
})(Marks || (Marks = {}));
console.log(tried(-1), tried(0), tried(5));
