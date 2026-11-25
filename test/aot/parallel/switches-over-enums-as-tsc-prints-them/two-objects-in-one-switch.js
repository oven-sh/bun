// The labels of the second object are come by only where no label of the first is the subject: until it is born they throw, and only then.
var First;
(function (First) {
    First[First["One"] = 1] = "One";
    First[First["Two"] = 2] = "Two";
})(First || (First = {}));
function kind(c) {
  switch (c) {
    case First.One: return "one";
    case 10: return "ten";
    case Second.Three: return "three";
    case First.Two: return "two";
    case Second.One: return "never: the first label with this number wins";
    case Second.Text: return "text";
    default: return "other";
  }
}
function tried(c) { try { return kind(c); } catch (error) { return error instanceof TypeError ? "TypeError" : String(error); } }
console.log(tried(1), tried(10), tried(2), tried(3), tried("t"), tried(4));
var Second;
(function (Second) {
    Second[Second["Three"] = 3] = "Three";
    Second[Second["One"] = 1] = "One";
    Second["Text"] = "t";
})(Second || (Second = {}));
console.log(tried(1), tried(10), tried(2), tried(3), tried("t"), tried(4));
