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

const log = [];

class Ranked extends Array {
  sort(compare) {
    log.push("sort with " + typeof compare);
    return super.sort((a, b) => b - a);
  }
  filter(keep) {
    log.push("filter");
    return super.filter((value, index) => !keep(value, index));
  }
  [Symbol.iterator]() {
    log.push("iterator");
    let index = this.length;
    return {
      next: () => (index > 0 ? { done: false, value: this[--index] } : { done: true, value: undefined }),
      return() {
        log.push("return");
        return {};
      },
    };
  }
  indexOf(value) {
    log.push("indexOf");
    return super.indexOf(value) + 100;
  }
  get first() {
    return this[0];
  }
}

function sorted(list) {
  return list.sort((a, b) => a - b);
}

function aboveOne(list) {
  return list.filter(value => value > 1);
}

function collected(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

function copied(list) {
  return [...list];
}

function firstTwo(list) {
  const [a, b] = list;
  return [a, b];
}

function placeOfTwo(list) {
  return list.indexOf(2);
}

function chained(list) {
  return list.filter(value => value > 1).sort((a, b) => a - b);
}

function largest(list) {
  return Math.max(...list);
}

const uses = { sorted, aboveOne, collected, copied, firstTwo, placeOfTwo, chained, largest };

function show(title, make) {
  for (const use in uses) {
    log.length = 0;
    attempt(title + ", " + use, () => uses[use](make()));
    console.log("  log: " + log.join(", "));
  }
}

show("the subclass first", () => Ranked.of(3, 1, 2));
show("an array", () => [3, 1, 2]);
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
show("the subclass after 2000 arrays", () => Ranked.of(3, 1, 2));
show("an array again", () => [3, 1, 2]);
show("an array relinked to the subclass", () => Object.setPrototypeOf([3, 1, 2], Ranked.prototype));
show("what the subclass's own filter returned", () => Ranked.of(3, 1, 2, 0).filter(value => value === 0));
show("what map returned for the subclass", () => Ranked.of(2, 0, 1).map(value => value + 1));
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use](Ranked.of(3, 1, 2));
log.length = 0;
show("an array after 2000 of the subclass", () => [3, 1, 2]);
