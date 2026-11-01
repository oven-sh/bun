// A spread of an exports object that has getters and, beside them, names made at run time.
// A getter that runs during the copy deletes those names, adds others, collects, or gives the object another prototype. The copy goes by the keys it listed at the start, and nothing else may hold their strings.
// COUNT: counter:CopiesByOrdinaryLookups = 0
let onFirst = () => {};
let onLast = () => {};
exports.a = 1;
Object.defineProperty(exports, "first", { enumerable: true, configurable: true, get: function () { onFirst(); return "first"; } });
exports.c = 3;
function defineLast() {
  Object.defineProperty(exports, "last", { enumerable: true, configurable: true, get: function () { onLast(); return "last"; } });
}

let round = 0;
const nameOf = (kind, k) => kind + " in round " + round + " number " + k;
const add = (kind, count) => { for (let k = 0; k < count; k++) exports[nameOf(kind, k)] = k; };
const remove = (kind, count) => { for (let k = 0; k < count; k++) delete exports[nameOf(kind, k)]; };
// A collection finds the strings dead. They are freed when their blocks are swept, which new strings bring about.
function collect() {
  Bun.gc(true);
  let length = 0;
  for (let k = 0; k < 30000; k++) length += ("filler " + round + " " + k).length;
  return length;
}
function describe(copy) {
  const keys = Object.keys(copy);
  let sum = 0;
  for (const key of keys) for (const text of [key, String(copy[key])]) for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return keys.length + " keys, " + sum + ", " + keys.slice(0, 4).join() + " ... " + keys.slice(-2).join();
}

const copies = {
  spread: source => ({ ...source }),
  "spread behind a member": source => ({ own: 0, ...source }),
  "spread in front of a member": source => ({ ...source, c: "own" }),
};
const changes = {
  nothing: () => {},
  collects: () => { collect(); },
  "deletes the names": count => { remove("made", count); collect(); },
  "deletes every second name": count => { for (let k = 0; k < count; k += 2) delete exports[nameOf("made", k)]; collect(); },
  "adds many names": () => { add("added", 700); collect(); },
  "deletes the names and adds as many": count => { remove("made", count); collect(); add("added", count); },
  "deletes the names and a field": count => { remove("made", count); delete exports.c; collect(); },
  "gives another prototype": count => { remove("made", count); Object.setPrototypeOf(exports, { [nameOf("made", 0)]: "inherited", a: "inherited" }); collect(); },
  "hides the names": count => { for (let k = 0; k < count; k++) Object.defineProperty(exports, nameOf("made", k), { enumerable: false }); collect(); },
};
const once = change => () => { onFirst = onLast = () => {}; change(); };

// Six names lie in a chain of Structures, seven hundred in a dictionary.
for (const count of [6, 700]) {
  for (const [way, copy] of Object.entries(copies)) {
    for (const [what, change] of Object.entries(changes)) {
      round++;
      add("made", count);
      onFirst = once(() => change(count));
      console.log(count, way, "|", what, "|", describe(copy(exports)));
      remove("made", count);
      remove("added", 700);
      exports.c = 3;
      Object.setPrototypeOf(exports, Object.prototype);
    }
  }
}

// A name that was looked up lately is held by a cache of the run time. These are more than it holds.
round++;
add("made", 6000);
onFirst = once(() => { remove("made", 6000); collect(); });
console.log("the first getter deletes six thousand names |", describe(copies.spread(exports)));

// This getter is defined behind the names, so they have been read when it runs.
round++;
add("made", 700);
defineLast();
onLast = once(() => { remove("made", 700); collect(); });
console.log("the last getter deletes the names |", describe(copies.spread(exports)));

round++;
add("made", 700);
onFirst = once(() => { for (const key of Object.getOwnPropertyNames(exports)) delete exports[key]; collect(); });
console.log("the first getter deletes all |", describe(copies.spread(exports)));
console.log(Object.getOwnPropertyNames(exports).length);
