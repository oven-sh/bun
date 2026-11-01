// Loops over a value that nobody knows, and over an iterator of the engine that nobody knows: nobody can see that a step of a Map's, a Set's or a list's iterator or of a generator makes no result object. What can be seen stays: who is called, in which order, what it throws, and that a method of its own is the one called.
// IR= 0 pairs key="done"
// IR= 0 pairs key="next"
// IR= 0 entriesOf key="done"
// IR= 0 walk key="done"
// IR= 0 sumOfPairs key="done"
// IR= 2 sumOfPairs = MapNext 

function pairs(pairsOrMap) {
  let total = "";
  for (const [key, value] of pairsOrMap) total += key + "=" + value + " ";
  return total;
}
function sumOfPairs(pairsOrMap) {
  let total = 0;
  for (const [key, value] of pairsOrMap) total += key + value;
  return total;
}
function entriesOf(map) {
  let total = "";
  for (const [key, value] of map.entries()) total += key + "=" + value + " ";
  return total;
}
function wholePairs(pairsOrMap) {
  const seen = [];
  for (const pair of pairsOrMap) {
    seen.push(pair);
    pair[0] += "!";
  }
  return seen.map(pair => pair[0] + ":" + pair[1] + ":" + pair.length).join(" ") + " " + (new Set(seen).size === seen.length);
}
function walk(iterable) {
  const seen = [];
  for (const value of iterable) seen.push(String(value));
  return seen.join(" ");
}
function walkAndLeave(iterable, count) {
  const seen = [];
  for (const value of iterable) {
    seen.push(String(value));
    if (seen.length === count) break;
  }
  return seen.join(" ");
}
function say(name, walker) {
  try {
    console.log(name, "->", walker());
  } catch (error) {
    console.log(name, "threw", error?.constructor?.name, error?.message);
  }
}
const hide = value => [value, null][JSON.parse("0")];

const map = () => new Map([["a", 1], ["b", 2], ["c", 3]]);
const set = () => new Set(["x", "y", "z"]);
const argumentsOf = function () { return arguments; };

for (const round of [1, 2]) {
  console.log("round", round);
  say("pairs of a map", () => pairs(hide(map())));
  say("sum of a map", () => sumOfPairs(hide(new Map([[1, 2], [3, 4]]))));
  say("sum of a list", () => sumOfPairs(hide([[1, 2], [3, 4]])));
  say("sum of a set", () => sumOfPairs(hide(new Set([[1, 2], [3, 4]]))));
  say("pairs of a list", () => pairs(hide([["k", 1], ["l", 2]])));
  say("pairs of a set", () => pairs(hide(new Set([["s", 1], "tu"]))));
  say("pairs of a string", () => pairs(hide("pq")));
  say("pairs of a generator", () => pairs(hide((function* () { yield ["g", 1]; yield "hi"; })())));
  say("pairs of arguments", () => pairs(hide(argumentsOf(["q", 1]))));
  say("pairs of a map's iterator", () => pairs(hide(map()[Symbol.iterator]())));
  say("pairs of values that are no lists", () => pairs(hide(new Map([[1, 2]]).keys())));
  say("pairs of nothing", () => pairs(hide(null)));
  say("pairs of a number", () => pairs(hide(1)));
  say("entries of a map", () => entriesOf(hide(map())));
  say("entries of a set", () => entriesOf(hide(set())));
  say("entries of a list", () => entriesOf(hide(["m", "n"])));
  say("whole pairs of a map", () => wholePairs(hide(map())));
  say("whole pairs of a list", () => wholePairs(hide([["k", 1], ["l", 2]])));
  say("keys", () => walk(hide(map().keys())));
  say("values", () => walk(hide(map().values())));
  say("set", () => walk(hide(set())));
  say("set entries", () => walk(hide(set().entries())));
  say("list", () => walk(hide([1, 2])));
  say("list's keys", () => walk(hide([1, 2].keys())));
  say("list's entries", () => walk(hide([1, 2].entries())));
  say("typed array's values", () => walk(hide(new Int8Array([3, 4]).values())));
  say("arguments' iterator", () => walk(hide(argumentsOf(5, 6)[Symbol.iterator]())));
  say("string's iterator", () => walk(hide("rs"[Symbol.iterator]())));
  say("generator", () => walk(hide((function* () { yield 7; yield 8; return 9; })())));

  // Who else steps the iterator sees where the loop is, and the other way around.
  say("stepped by hand in the loop", () => {
    const iterator = hide(new Map([[1, 1], [2, 2], [3, 3], [4, 4]]).keys());
    const seen = [];
    for (const key of iterator) {
      seen.push(key);
      seen.push(iterator.next().value);
    }
    return seen.join(" ");
  });
  say("left, then walked again", () => {
    const iterator = hide(new Set([1, 2, 3]).values());
    return walkAndLeave(iterator, 1) + " | " + walk(iterator) + " | " + walk(iterator);
  });
  say("an ended iterator stays ended", () => {
    const grown = new Map([[1, 1]]);
    const iterator = hide(grown.keys());
    const first = walk(iterator);
    grown.set(2, 2);
    return first + " | " + walk(iterator);
  });
  say("a list's iterator that ended stays ended", () => {
    const list = [1];
    const iterator = hide(list.values());
    const first = walk(iterator);
    list.push(2);
    return first + " | " + walk(iterator);
  });
  say("a map that changes under the iterator", () => {
    const changed = new Map([[1, 1], [2, 2], [3, 3]]);
    const seen = [];
    for (const [key] of hide(changed)) {
      seen.push(key);
      if (key === 1) { changed.delete(2); changed.set(4, 4); }
      if (key === 3) changed.clear();
    }
    return seen.join(" ");
  });
  say("a map that is rehashed under the iterator", () => {
    const changed = new Map([[0, 0]]);
    let count = 0;
    for (const key of hide(changed.keys())) {
      count += 1;
      if (key < 200) changed.set(key + 1, 0);
    }
    return count;
  });

  // Closing.
  say("leaving a generator runs its finally", () => {
    const log = [];
    const generator = hide((function* () { try { yield 1; yield 2; } finally { log.push("finally"); } })());
    return walkAndLeave(generator, 1) + " " + log + " " + generator.next().done;
  });
  say("leaving an iterator with a return", () => {
    const log = [];
    const iterator = hide(new Map([[1, 1], [2, 2]]).keys());
    iterator.return = function () { log.push("return"); return {}; };
    return walkAndLeave(iterator, 1) + " " + log;
  });

  // What a method of the program does stays what it does.
  say("order of reads", () => {
    const log = [];
    const iterator = {
      n: 0,
      [Symbol.iterator]() { log.push("iterator"); return this; },
      get next() { log.push("next read"); return () => { log.push("next called"); return result(this.n++ > 0); }; },
    };
    const result = done => ({ get done() { log.push("done"); return done; }, get value() { log.push("value"); return "v"; } });
    return walk(hide(iterator)) + " " + log.join();
  });
  say("a result that is no object", () => walk(hide({ [Symbol.iterator]() { return { next: () => 1 }; } })));
  say("next that is no function", () => {
    try {
      return walk(hide({ [Symbol.iterator]() { return { next: 1 }; } }));
    } catch (error) {
      return error.constructor.name;
    }
  });
  say("next that throws", () => walk(hide({ [Symbol.iterator]() { return { next() { throw new RangeError("from next"); } }; } })));
  say("an iterator of another class by this", () => {
    const next = new Map().keys().next;
    return walk(hide({ [Symbol.iterator]() { return { next }; } }));
  });
  say("a set's iterator with the next of a map's", () => {
    const iterator = new Set([1]).values();
    iterator.next = new Map().keys().next;
    return walk(hide(iterator));
  });
  say("a list's iterator with the next of its own", () => {
    const iterator = [1, 2].values();
    let left = 2;
    iterator.next = () => ({ done: !left--, value: "own" });
    return walk(hide(iterator));
  });
  say("a generator that is running", () => {
    let generator;
    generator = (function* () { yield 1; walk(hide(generator)); yield 2; })();
    return walk(hide(generator));
  });
  say("a generator that throws, and its stack", () => {
    const generator = (function* thrower() { yield 1; throw new Error("from the generator"); })();
    try {
      return walk(hide(generator));
    } catch (error) {
      return error.message + " " + /thrower/.test(error.stack);
    }
  });
  say("a list detached under its iterator", () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    const iterator = hide(view.values());
    iterator.next();
    structuredClone(buffer, { transfer: [buffer] });
    return walk(iterator);
  });
}

class Pairs extends Map { *[Symbol.iterator]() { yield ["own", 1]; } }
say("a subclass of Map with an @@iterator of its own", () => pairs(hide(new Pairs([["a", 1]]))));
