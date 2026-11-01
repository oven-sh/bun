// List patterns in list patterns and for-of loops in for-of loops, over lists the compiler knows, lists it does not, and iterators that say when they are stepped and closed.
// The compiler takes the iterations of such a nest apart together: each still reads what plain Bun reads, in its order, and closes what plain Bun closes.
const log = [];
function show(name, value) {
  console.log(name + ": " + JSON.stringify(value) + (log.length ? " | " + log.splice(0).join(" ") : ""));
}
function attempt(name, run) {
  try {
    show(name, run());
  } catch (error) {
    show(name, "threw " + (error instanceof TypeError ? "a TypeError" : error.message));
  }
}
function talking(name, values, failsAt = -1) {
  let position = 0;
  return {
    [Symbol.iterator]() { log.push(name + ".open"); return this; },
    next() {
      log.push(name + ".next");
      if (position === failsAt) throw new Error(name + " fails");
      return position < values.length ? { done: false, value: values[position++] } : { done: true, value: undefined };
    },
    return() { log.push(name + ".return"); return {}; },
  };
}
const unknown = text => JSON.parse(text);

// Lists that are written here.
function known() {
  const [[[a, b], c], [d, [e]], f] = [[[1, 2], 3], [4, [5]], 6];
  return [a, b, c, d, e, f];
}
show("known", known());
function knownShort() {
  const [[[a, b = "b"], c = "c"] = [[]], [d] = ["d"], e = "e"] = [[[1]]];
  return [a, b, c, d, e];
}
show("short", knownShort());

// What stands between the steps of the outer pattern changes the outer list.
function innerDefaultChangesOuter() {
  const outer = [[], 2, 3];
  const [[x = (outer[1] = "changed", outer.length = 2, 1)], y, z] = outer;
  return [x, y, z, outer];
}
show("an inner default changes the outer list", innerDefaultChangesOuter());
function innerDefaultChangesInner() {
  const inner = [undefined, 2];
  const [[x = (inner[1] = "changed", 1), y], z] = [inner, 3];
  return [x, y, z];
}
show("an inner default changes the inner list", innerDefaultChangesInner());
function threeDeep(list) {
  const [[[x = (list.push("more"), list[0].push("pushed"), 0)], y], z, w] = list;
  return [x, y, z, w];
}
show("three deep", threeDeep([[[]], "z"]));

// Lists that nobody knows.
function apart(list) {
  const [[[a], b], [c, [d, e]]] = list;
  return [a, b, c, d, e];
}
show("parsed", apart(unknown("[[[1],2],[3,[4,5]]]")));
attempt("parsed, too shallow", () => apart(unknown("[[1,2],[3,[4,5]]]")));
attempt("parsed, a string inside", () => apart(unknown('[[["xy"],"b"],["c",["de","f"]]]')));
attempt("parsed, null inside", () => apart(unknown("[[[1],2],null]")));

// Iterators that talk.
attempt("iterators", () => apart(talking("outer", [talking("first", [talking("deep", [1, 9]), 2, 9]), talking("second", [3, talking("last", [4, 5, 9])])])));
attempt("the deepest fails", () => apart(talking("outer", [talking("first", [talking("deep", [1], 0), 2])])));
attempt("the middle fails at its second step", () => apart(talking("outer", [talking("first", [[1], 2], 1), [3, [4, 5]]])));
attempt("a list in iterators", () => apart(talking("outer", [[talking("deep", []), 2], talking("second", [3, [4, 5]])])));

// Loops.
function sums(lists, stopAt) {
  let sum = 0;
  outer: for (const rows of lists) {
    for (const row of rows) {
      for (const cell of row) {
        if (cell === stopAt) break outer;
        if (cell < 0) continue outer;
        if (cell === 0) break;
        sum += cell;
      }
      sum += 100;
    }
    sum += 1000;
  }
  return sum;
}
show("loops", [sums([[[1, 2], [3]], [[4]]], 99), sums([[[1, 2], [3]], [[4]]], 3), sums([[[1, -2], [3]], [[4, 0, 5]]], 99)]);
show("loops over parsed lists", [sums(unknown("[[[1,2],[3]],[[4]]]"), 99), sums(unknown("[[[1,2],[3]],[[4]]]"), 4)]);
attempt("loops over iterators, left from the inside", () => sums(talking("a", [talking("b", [talking("c", [1, 7, 2])])]), 7));
attempt("loops over iterators, the next round of the outermost", () => sums(talking("a", [talking("b", [talking("c", [1, -1, 2]), [5]]), [[6]]]), 99));
attempt("loops over iterators, one fails", () => sums(talking("a", [talking("b", [talking("c", [1, 2], 1)])]), 99));
attempt("loops over what cannot be walked", () => sums([[5]], 99));

// A pattern in the head of a loop in a loop, and a loop in a generator that is left early.
function pairs(table) {
  const out = [];
  for (const [key, [first, ...rest]] of table) for (const [index, value] of rest.entries()) out.push(key + first + index + value);
  return out;
}
show("patterns in loop heads", pairs([["a", [1, 2, 3]], ["b", [4]], ["c", "xyz"]]));
function* walk(lists) {
  for (const list of lists) for (const [value] of list) yield value;
}
function firstTwo(lists) {
  const out = [];
  for (const value of walk(lists)) {
    out.push(value);
    if (out.length === 2) break;
  }
  return out;
}
attempt("a generator left early", () => firstTwo(talking("g", [talking("h", [[1], talking("i", [2, 3]), [4]])])));

// Deep enough that no copy of the inside is made for each kind of list.
function deep(list) {
  const [[[[[[[[[[[[a, b]]]]]]]]]]], c] = list;
  return [a, b, c];
}
show("twelve deep", [deep([[[[[[[[[[[[1, 2]]]]]]]]]]], 3]), deep(unknown("[[[[[[[[[[[[1,2]]]]]]]]]]],3]"))]);
attempt("twelve deep, an iterator at the bottom", () => deep([[[[[[[[[[[talking("bottom", [1, 2, 3])]]]]]]]]]], 3]));
attempt("twelve deep, cut off", () => deep([[[[[[undefined]]]]], 3]));
