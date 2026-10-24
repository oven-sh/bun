function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const cases = {
  deleted(flag) {
    const list = [1, 2, 3];
    if (flag) delete list[1];
    return [list[1], 1 in list, list.length];
  },
  deletedFromDoubles(flag) {
    const list = [1.5, 2.5, 3.5];
    if (flag) delete list[1];
    return [list[1], 1 in list, list[1] + 1];
  },
  grownByLength(flag) {
    const list = [1, 2, 3];
    if (flag) list.length = 5;
    return [list[4], 4 in list, list.length];
  },
  doublesGrownByLength(flag) {
    const list = [1.5, 2.5];
    if (flag) list.length = 3;
    return [list[2], 2 in list, list[2] * 2];
  },
  storedPastTheEnd(flag) {
    const list = [1, 2, 3];
    if (flag) list[5] = 6;
    return [list[4], list[5], list.length];
  },
  doublesStoredPastTheEnd(flag) {
    const list = [1.5];
    if (flag) list[2] = 2.5;
    return [list[1], 1 in list, list.length];
  },
  shrunkAndGrown(flag) {
    const list = [1, 2, 3];
    if (flag) {
      list.length = 1;
      list.length = 3;
    }
    return [list[2], 2 in list];
  },
  popped(flag) {
    const list = [1, 2, 3];
    if (flag) list.pop();
    return [list[2], list.length];
  },
  shifted(flag) {
    const list = [1, 2, 3];
    if (flag) list.shift();
    return [list[2], list[0], list.length];
  },
  spliced(flag) {
    const list = [1, 2, 3];
    if (flag) list.splice(1, 1);
    return [list[2], list[1], list.length];
  },
  sized(flag) {
    const list = new Array(flag ? 3 : 0);
    list[0] = 1;
    return [list[1], 1 in list, list.length];
  },
  sizedAndHalfFilled(flag) {
    const list = new Array(4);
    for (let i = 0; i < (flag ? 2 : 4); i++) list[i] = i;
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  pushedThenDeleted(flag) {
    const list = [];
    for (let i = 0; i < 4; i++) list.push(i);
    if (flag) delete list[2];
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  filledThenDeleted(flag) {
    const list = new Array(3).fill(1);
    if (flag) delete list[0];
    return [list[0], list.reduce((total, value) => total + value, 0)];
  },
  mappedFromHoles(flag) {
    const list = (flag ? [1, , 3] : [1, 2, 3]).map(value => value * 2);
    return [list[1], 1 in list, list.length];
  },
  copiedFromHoles(flag) {
    const source = flag ? [1, , 3] : [1, 2, 3];
    return [1 in source.slice(), 1 in [...source], 1 in Array.from(source), 1 in source.concat(), 1 in source.toSorted(), 1 in source.filter(() => true)];
  },
  walkedWithAHole(flag) {
    const list = [1, 2, 3];
    if (flag) delete list[1];
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  visitedWithAHole(flag) {
    const list = [1, 2, 3];
    if (flag) delete list[1];
    const seen = [];
    list.forEach((value, index) => seen.push(index));
    return seen;
  },
  readOutside(flag) {
    const list = [1, 2, 3];
    const index = flag ? 3 : 2;
    return [list[index], list[-index], list[index + 0.5], list[index * 1e9]];
  },
  notANumberIsNoHole(flag) {
    const list = [1.5, 2.5];
    if (flag) list[1] = NaN;
    return [list[1], 1 in list, list.includes(NaN), list.indexOf(NaN)];
  },
  notANumberByArithmetic(flag) {
    const list = [1.5, 2.5];
    list[1] = flag ? 0 / 0 : 1;
    list[0] = flag ? Infinity - Infinity : 1;
    return [list[0], list[1], 0 in list, 1 in list];
  },
  undefinedIsNoHole(flag) {
    const list = [1, 2, 3];
    if (flag) list[1] = undefined;
    return [list[1], 1 in list, Object.keys(list).join()];
  },
};

for (const name in cases) for (let i = 0; i < 1000; i++) cases[name](false);
for (const name in cases) {
  attempt(name + ", untouched", () => cases[name](false));
  attempt(name + ", with the hole", () => cases[name](true));
  attempt(name + ", untouched again", () => cases[name](false));
}
