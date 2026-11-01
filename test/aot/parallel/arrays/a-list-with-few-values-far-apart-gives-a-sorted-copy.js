// `a[200_000] = 1` gives a list storage that is far shorter than the list. toSorted() with a comparator asked for a copy in one piece as long as the list, which a list of over 2 ** 28 elements cannot have.
// Here the lists are short enough for plain Bun to answer at once: every way through the copy that grows with what is found.
const lines = [];
function say(name, list) {
  let own = 0;
  for (let index = 0; index < list.length; index++) if (index in list) own++;
  lines.push(
    name +
      ": " +
      list.length +
      " long, " +
      own +
      " own, starts " +
      JSON.stringify(list.slice(0, 6)) +
      ", ends " +
      JSON.stringify(list.slice(-2)),
  );
}
const byDifference = (x, y) => x - y;

const sparse = [];
sparse[200_000] = 1;
sparse[0] = 2;
sparse[7] = undefined;
sparse[150_000] = -3;

const denseInOtherStorage = [5, 4, 3, 2, 1, 9, 8, 7, 6, 0, 15, 14, 13, 12, 11, 10, 19, 18, 17, 16];
denseInOtherStorage[500_000] = 1;
denseInOtherStorage.length = 20;

const empty = new Array(5);
const none = [];

const inherits = [];
inherits[100_000] = 4;
inherits[1] = 6;
Object.setPrototypeOf(inherits, { __proto__: Array.prototype, 3: 5 });

const texts = [];
texts[120_000] = "b";
texts[2] = "a";
texts[60_000] = "c";

const calls = [];
const counted = [];
counted[90_000] = 3;
counted[1] = 1;
counted[45_000] = 2;

say("sparse", sparse.toSorted(byDifference));
say("the list itself", sparse);
say("dense in other storage", denseInOtherStorage.toSorted(byDifference));
say("holes alone", empty.toSorted(byDifference));
say("nothing", none.toSorted(byDifference));
say("an element of the prototype", inherits.toSorted(byDifference));
say(
  "texts",
  texts.toSorted((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
);
say(
  "counted",
  counted.toSorted((x, y) => (calls.push(x + "," + y), y - x)),
);
lines.push("the comparator saw " + calls.join(" "));
lines.push(
  "a new list: " +
    (sparse.toSorted(byDifference) !== sparse) +
    ", an Array: " +
    Array.isArray(sparse.toSorted(byDifference)),
);
console.log(lines.join("\n"));
