// for-of, spread, destructuring, Array.from, new Set and yield* in a callee ask the object for Symbol.iterator and the iterator for next. One array, Map or Set among many has a method of its own, a prototype in between, an accessor under the symbol, a hole over an accessor, or is an instance of a class below.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag ?? "untagged").join("+") || "nobody";
const ways = {
  forOf(items) {
    let text = "";
    for (const item of items) text += item + ";";
    return text;
  },
  spread: items => [...items].join(";"),
  pattern(items) {
    const [first, second] = items;
    return first + ";" + second;
  },
  from: items => Array.from(items).join(";"),
  set: items => new Set(items).size,
  delegate(items) {
    function* all() {
      yield* items;
    }
    return Array.from(all()).join(";");
  },
  call: items => Math.max(...items),
};
function* spying(self) {
  kept.push(self);
  yield 7;
  yield 8;
}
const makers = {
  plain: () => [1, 2, 3],
  ownMethod() {
    const list = [1, 2, 3];
    list.tag = "ownMethod";
    list[Symbol.iterator] = function () {
      return spying(this);
    };
    return list;
  },
  ownAccessor() {
    const list = [1, 2, 3];
    list.tag = "ownAccessor";
    return Object.defineProperty(list, Symbol.iterator, {
      get() {
        kept.push(this);
        return Array.prototype.values;
      },
    });
  },
  between() {
    const list = [1, 2, 3];
    list.tag = "between";
    return Object.setPrototypeOf(list, {
      __proto__: Array.prototype,
      [Symbol.iterator]() {
        return spying(this);
      },
    });
  },
  heir() {
    class Heir extends Array {
      tag = "heir";
      [Symbol.iterator]() {
        return spying(this);
      }
    }
    return Heir.of(1, 2, 3);
  },
  holeOverAccessor() {
    const list = [1, , 3];
    list.tag = "holeOverAccessor";
    return Object.setPrototypeOf(list, {
      __proto__: Array.prototype,
      get 1() {
        kept.push(this);
        return 22;
      },
    });
  },
  ownLength() {
    const list = [1, 2, 3];
    list.tag = "elementAccessor";
    return Object.defineProperty(list, 2, {
      get() {
        kept.push(this);
        return 33;
      },
    });
  },
  map: () => new Map([[1, 2]]),
  mapOwnMethod() {
    const map = new Map([[1, 2]]);
    map.tag = "mapOwnMethod";
    map[Symbol.iterator] = function () {
      return spying(this);
    };
    return map;
  },
  setBetween() {
    const set = new Set([1, 2]);
    set.tag = "setBetween";
    return Object.setPrototypeOf(set, {
      __proto__: Set.prototype,
      [Symbol.iterator]() {
        return spying(this);
      },
    });
  },
};
const lines = [];
for (const [way, run] of Object.entries(ways)) {
  for (const [name, make] of Object.entries(makers)) {
    lines.push(way + " " + name + " " + run(make()));
    churn(20);
    lines.push(report());
  }
}
console.log(lines.join("\n"));
