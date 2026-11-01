const word = process.argv[2] ?? "word";
const launder = new Function("v", "return v" + word.slice(word.length));
function note(i) { return { role: word + i, text: word + "-text" }; }
function maybe(i) { return i % 3 === 0 ? undefined : i % 3 === 1 ? null : note(i); }
function either(i) { return i & 1 ? note(i) : { id: i, ok: i > 2 }; }
function list(i) { return i & 1 ? [note(i), note(i + 1)] : []; }
function listOrNothing(i) { return i & 1 ? [i, i + 0.5] : undefined; }
function reshaped(i) { const o = note(i); if (i & 1) { delete o.role; o.role = "late"; } return o; }
function grown(i) { const o = note(i); if (i & 1) o.more = i; return o; }
function withToJSON(i) { const o = note(i); if (i & 1) o.toJSON = () => "by toJSON " + i; return o; }
function toNothing(i) { const o = note(i); if (i & 1) o.toJSON = () => undefined; return o; }
function cyclic(i) { const o = { self: null, id: i }; if (i & 1) o.self = o; return o; }
function holdsNothing(i) { return { a: i & 1 ? undefined : i, b: i & 2 ? undefined : "b" }; }
function nested(i) { return { head: note(i), tail: i & 1 ? null : note(i + 1), label: word }; }
function functionOrObject(i) { return i & 1 ? () => i : note(i); }
function symbolOrObject(i) { return i & 1 ? Symbol.iterator : note(i); }
const makers = [note, maybe, either, list, listOrNothing, reshaped, grown, withToJSON, toNothing, cyclic, holdsNothing, nested, functionOrObject, symbolOrObject];
function show(make, i) {
  try {
    return String(JSON.stringify(make(i)));
  } catch (error) {
    return error.constructor.name;
  }
}
function showNote(i) { return JSON.stringify(note(i)); }
function showMaybe(i) { return String(JSON.stringify(maybe(i))); }
function showEither(i) { return JSON.stringify(either(i)); }
function showList(i) { return JSON.stringify(list(i)); }
function showListOrNothing(i) { return String(JSON.stringify(listOrNothing(i))); }
function showReshaped(i) { return JSON.stringify(reshaped(i)); }
function showGrown(i) { return JSON.stringify(grown(i)); }
function showWithToJSON(i) { return JSON.stringify(withToJSON(i)); }
function showToNothing(i) { return String(JSON.stringify(toNothing(i))); }
function showCyclic(i) { try { return JSON.stringify(cyclic(i)); } catch (error) { return error.constructor.name; } }
function showHoldsNothing(i) { return JSON.stringify(holdsNothing(i)); }
function showNested(i) { return JSON.stringify(nested(i)); }
function showFunctionOrObject(i) { return String(JSON.stringify(functionOrObject(i))); }
function showSymbolOrObject(i) { return String(JSON.stringify(symbolOrObject(i))); }
function showLaundered(i) { return String(JSON.stringify(launder(maybe(i)))); }
const shows = [showNote, showMaybe, showEither, showList, showListOrNothing, showReshaped, showGrown, showWithToJSON, showToNothing, showCyclic, showHoldsNothing, showNested, showFunctionOrObject, showSymbolOrObject, showLaundered];
for (let i = 0; i < 6; i++) {
  for (const make of makers) console.log(make.name, i, show(make, i));
  for (const each of shows) console.log(each.name, i, each(i));
}
