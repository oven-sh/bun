var Marks;
(function (Marks) {
    Marks[Marks["End"] = -1] = "End";
    Marks[Marks["Middle"] = 7] = "Middle";
})(Marks || (Marks = {}));
export function kind(c) {
  switch (c) {
    case Marks.End: return "end";
    case Marks.Middle: return "middle";
    default: return "other";
  }
}
export { Marks as Signs };
