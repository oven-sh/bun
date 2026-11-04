// A default of a parameter property reads an earlier parameter, and a later default reads the property's parameter.
let calls = 0;
function next() { return ++calls; }
class Span { constructor(public from: number, public to = from * 2, readonly step = to - from, public stamp = next()) {} }
const Again = (0, eval)("(function (next) { return (" + String(Span) + "); })")(next);
for (const Made of [Span, Again]) {
  console.log(JSON.stringify(new Made(3)), JSON.stringify(new Made(3, 10)), JSON.stringify(new Made(1, 2, 3, 4)), JSON.stringify(new Made(1, undefined, undefined, undefined)), Made.length);
}
