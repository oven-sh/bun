// The labels are members of an enum as tsc prints it. Only this file names the variable, and only to look members up:
// nobody can change the object, so behind the first label, which throws where the object is not born yet, the labels are the constants that the form wrote.

// RUN(CLOSED): lower
// CLOSED-LABEL: function {{*}}name="closed"
// CLOSED: [[object]] = GetModuleVariable
// CLOSED: PropGet [[object]] key="Low"
// CLOSED-NOT: StrictEq
// CLOSED: Switch {{*}}cases=[-1, 1, 2]
// CLOSED-NOT: StrictEq
// CLOSED: Return

// The object is handed on: every label is read.
// RUN(OPEN): lower
// OPEN-LABEL: function {{*}}name="open"
// OPEN-NOT: Switch
// OPEN: PropGet {{*}}key="Low"
// OPEN: StrictEq
// OPEN: PropGet {{*}}key="High"
// OPEN: StrictEq

// A member is stored to.
// RUN(STORED): lower
// STORED-LABEL: function {{*}}name="stored"
// STORED-NOT: Switch
// STORED: StrictEq
// STORED: StrictEq

// Two objects: the first label off the second stands behind the table of the first.
// RUN(TWO): lower
// TWO-LABEL: function {{*}}name="two"
// TWO: PropGet {{*}}key="Low"
// TWO: Switch {{*}}cases=[-1, 5]
// TWO: PropGet {{*}}key="Far"
// TWO: Switch {{*}}cases=[8, 1]

var Closed;
(function (Closed) {
  Closed[(Closed["Low"] = -1)] = "Low";
  Closed[(Closed["High"] = 1)] = "High";
  Closed[(Closed["Top"] = 2)] = "Top";
})(Closed || (Closed = {}));
var Other;
(function (Other) {
  Other[(Other["Far"] = 8)] = "Far";
})(Other || (Other = {}));
var Open;
(function (Open) {
  Open[(Open["Low"] = -1)] = "Low";
  Open[(Open["High"] = 1)] = "High";
})(Open || (Open = {}));
var Stored;
(function (Stored) {
  Stored[(Stored["Low"] = -1)] = "Low";
  Stored[(Stored["High"] = 1)] = "High";
})(Stored || (Stored = {}));

export function closed(c) {
  switch (c) {
    case Closed.Low:
      return "low";
    case Closed.High:
      return "high";
    case Closed["Top"]:
      return Closed[c];
    default:
      return "other";
  }
}

export function open(c) {
  switch (c) {
    case Open.Low:
      return "low";
    case Open.High:
      return "high";
    default:
      return Object.keys(Open);
  }
}

export function stored(c) {
  switch (c) {
    case Stored.Low:
      return "low";
    case Stored.High:
      return "high";
    default:
      Stored.High = c;
  }
}

export function two(c) {
  switch (c) {
    case Closed.Low:
      return "low";
    case 5:
      return "five";
    case Other.Far:
      return "far";
    case Closed.High:
      return "high";
  }
}
