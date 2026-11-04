// `x.replace(/a/g, "b")`, `x.split(/,/)`, nothing known of `x`. Where `x` is a string no evaluation can be told from another. Where it is anything else each evaluation hands over an object of its own.
const lines = [];
const show = value => typeof value === "string" ? JSON.stringify(value) : value instanceof RegExp ? "pattern " + value.source + " " + value.flags + " " + value.lastIndex : Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : String(value);
const note = (...parts) => lines.push(parts.map(show).join(" "));
const box = JSON.parse('{"held":null}');
const unknown = value => { box.held = value; return box.held; };
const attempt = ask => { try { return ask(); } catch (error) { return "threw " + error.constructor.name; } };

function everyA(x) { const result = x.replace(/a/g, "-"); return result; }
function firstA(x) { const result = x.replace(/a/, "-"); return result; }
function stickyA(x) { const result = x.replace(/a/y, "-"); return result; }
function byFunction(x, replacer) { const result = x.replace(/(a)(b)?/g, replacer); return result; }
function commas(x) { const result = x.split(/\s*,\s*/); return result; }
function commasUpTo(x, limit) { const result = x.split(/,/, limit); return result; }
function inTail(x) { return x.replace(/a/g, "+"); }
function twice(x) { const result = x.replace(/a/g, "b").replace(/b/g, "c"); return result; }

const texts = ["", "a", "banana", "no such letter", "a,b , c", "café a", "世a界a", "x".repeat(50) + "a"].map(unknown);
for (const text of texts)
  note(everyA(text), firstA(text), stickyA(text), byFunction(text, (all, one, two, at) => "<" + all + one + two + at + ">"), commas(text), commasUpTo(text, 2), inTail(text), twice(text));

// A receiver with methods of its own gets the pattern into its hands.
const keeper = unknown({ replace(pattern, by) { return pattern; }, split(pattern, limit) { return pattern; } });
for (const ask of [everyA, firstA, stickyA, commas, inTail, x => byFunction(x, String), x => commasUpTo(x, 1)]) {
  const first = ask(keeper), second = ask(keeper);
  note(first, first === second, first instanceof RegExp, Object.getPrototypeOf(first) === RegExp.prototype, Object.keys(first).length);
  first.lastIndex = 3; first.mine = "kept"; Object.freeze(first);
  const third = ask(keeper);
  note(third, third.mine, Object.isFrozen(third), third === first);
  third.compile("z", "i");
  note(ask(keeper), third);
}
// What was done to those objects does nothing to the strings that come by the same places.
for (const text of texts.slice(1, 4))
  note(everyA(text), firstA(text), stickyA(text), commas(text), inTail(text));

// Strings and other receivers in turn.
{
  const seen = new Set(); let joined = "";
  for (let i = 0; i < 300; i++) {
    const result = everyA(i % 3 ? texts[2] : keeper);
    if (typeof result === "string") joined = result; else { seen.add(result); result.lastIndex = i; }
  }
  note(seen.size, joined, [...seen].slice(0, 3).map(pattern => pattern.lastIndex));
}

// Receivers of other kinds.
class Loud extends String { replace(pattern, by) { return "loud " + pattern.source + " " + super.replace(pattern, by); } }
for (const receiver of [new String("banana"), new Loud("banana"), 5, true, null, undefined, Symbol("a"), [], { }, { replace: 5 }, { replace: null }, () => "a", new Proxy({ }, { get: (target, key) => (pattern => String(key) + " " + pattern.source) })])
  note(attempt(() => everyA(unknown(receiver))), attempt(() => commas(unknown(receiver))), attempt(() => inTail(unknown(receiver))));
{
  const order = [];
  const watched = unknown({ get replace() { order.push("read"); return pattern => { order.push("called with lastIndex " + pattern.lastIndex); return "done"; }; } });
  note(everyA(watched), everyA(watched), order.join(" | "));
}
{
  const own = unknown(Object.assign(new String("banana"), { replace: pattern => pattern }));
  note(everyA(own) === everyA(own), everyA(own));
}

// The function that replaces comes by the same place again.
{
  let depth = 0;
  const again = all => depth++ < 3 ? "(" + byFunction(unknown("xab" + depth), again) + ")" : all.toUpperCase();
  note(byFunction(unknown("ab a ab"), again), depth);
  note(attempt(() => byFunction(unknown("ab"), () => { throw new RangeError("out"); })), byFunction(unknown("ab"), () => "fine"));
}
// What matched last.
everyA(unknown("xay")); note(RegExp.lastMatch, RegExp.leftContext, RegExp.rightContext);
commas(unknown("p , q")); note(RegExp.lastMatch);
console.log(lines.join("\n"));
