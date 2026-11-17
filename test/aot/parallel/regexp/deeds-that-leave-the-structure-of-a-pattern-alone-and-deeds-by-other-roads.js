// Whether lastIndex may be written is a bit of the RegExp object itself: `Object.defineProperty(pattern, "lastIndex", { writable: false })` leaves the object looking as made, so compiled code brings it to the fast way of
// `text.match(pattern)` and `text.search(pattern)`, which has to see the bit or the value for itself. An exec of its own, another parent and a matcher that is no function come by roads other than an assignment.
const said = [], show = value => Object.is(value, -0) ? "-0" : String(value);
function attempt(deed) { try { const found = deed(); return Array.isArray(found) ? found[0] + "@" + found.index : String(found); } catch (error) { return error.name; } }
function both(name, pattern, text) {
  const found = attempt(() => text.match(pattern)), between = pattern.lastIndex, at = attempt(() => text.search(pattern));
  said.push(name + ": " + found + " | " + at + " | " + show(between) + " " + show(pattern.lastIndex));
}
const locked = (pattern, at) => Object.defineProperty(pattern, "lastIndex", { value: at, writable: false });
const from = (pattern, at) => { pattern.lastIndex = at; return pattern; };
const loud = function (text) { said.push("its own exec sees " + text); return null; };
class Heir extends RegExp { exec(text) { said.push("an heir sees " + text); return super.exec(text); } }
const set = /b+/; Reflect.set(set, "exec", loud);
const kinds = [["as made", /b+/], ["as made", /b+/], ["locked at 0", locked(/b+/, 0)], ["locked at 3", locked(/b+/, 3)], ["sticky, locked at 1", locked(/b+/y, 1)], ["sticky, locked at 0", locked(/b+/y, 0)],
  ["minus zero", from(/b+/, -0)], ["sticky from 1.5", from(/b+/y, 1.5)], ["sticky from -5", from(/a/y, -5)], ["sticky from 9", from(/b/y, 9)],
  ["exec is defined", Object.defineProperty(/b+/, "exec", { value: loud })], ["exec is assigned from", Object.assign(/b+/, { exec: loud })], ["exec is set", set],
  ["another parent", Object.setPrototypeOf(/b+/, Heir.prototype)], ["no matcher", Object.defineProperty(/b+/, Symbol.match, { value: false })]];
for (const [name, pattern] of kinds) both(name, pattern, "abbc");
console.log(said.join("\n"));
