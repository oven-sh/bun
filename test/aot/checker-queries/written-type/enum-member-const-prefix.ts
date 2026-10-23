// `bun run` inlines a `const` of the const local prefix of a scope into what it visits later, so an enum member that reads one is a constant. A `const` after the prefix, one in the statement list of the enum, one below the reader and one that holds a string rope are variables.
const leading = 5;
const leadingText = "w", leadingSum = leading + 1;
const joined = "a" + "b";
const filled = `${leadingText}-${leading}`;
interface Erased {}
let count = 0;
const afterLet = 7;
function reads() {
  enum E {
    FromLeading = leading,
    AfterLeading,
    FromText = leadingText,
    FromSum = leadingSum,
    FromJoined = joined,
    FromFilled = filled,
    FromAfterLet = afterLet,
    AfterAfterLet,
  }
  const inner = 3;
  enum SameList { FromInner = inner }
  {
    enum Nested { FromInner = inner }
  }
}
function order() {
  function before() {
    enum E { FromBelow = below }
  }
  const below = 6;
}
function clauses(selector: number) {
  const outer = 1;
  switch (selector) {
    case 0:
      const early = 2;
    case 1:
      enum InLaterClause { FromEarly = early, FromOuter = outer }
      const late = 3;
      enum InOwnClause { FromLate = late }
  }
}
namespace Space {
  const local = 4;
  function inside() {
    enum E { FromLocal = local }
  }
}
export {};
