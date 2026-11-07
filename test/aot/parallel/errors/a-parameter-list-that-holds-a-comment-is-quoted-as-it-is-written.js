// An error quotes the call that failed as Bun prints it, with the functions that lie in it. Bun prints a parameter list of plain names
// that holds a comment as it is written, so the quote has the comments of such a list. Any other list, and the list of a setter, is
// printed without them.
function tell(label, run) {
  try { run(); console.log(label + ": no error"); } catch (error) { console.log(label + ": " + JSON.stringify(error.message)); }
}
const o = { none: null };

tell("function", () => o.nothing(function (/* the token */ name, other /* after */) {}));
tell("named function", () => o.nothing(function named(/* a */a,/* b */b) { return a + b }));
tell("arrow", () => o.nothing((/* one */ a, /* two */ b) => a + b));
tell("async arrow", () => o.nothing(async (/* one */ a) => { await a }));
tell("generator", () => o.nothing(function* (/* each */ ...all) { yield all }));
tell("method", () => o.nothing({ method(/* m */ a) {}, get value(/* none */) { return 1 }, set value(/* v */ next,) {} }));
tell("class", () => o.nothing(class { constructor(/* c */ a) {} static make(/* s */ a) {} }));
tell("no parameter", () => o.nothing((/* none */) => 1));
tell("lines", () => o.nothing(function (
    // the first
    a,
    b, // the second
) {}, 2));
tell("a read", () => (function (/* the token */ name) {}).nothing.deep);
tell("a default value", () => o.nothing(function (/* c */ a = 1) {}));
tell("a pattern", () => o.nothing((/* c */ { a }) => a));
tell("comments outside the list", () => o.nothing(function /* c */ (a) /* d */ {}, async /* e */ (a) => a));
