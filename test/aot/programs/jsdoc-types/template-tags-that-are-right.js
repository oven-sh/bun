/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function same(value) {
  return value;
}

/**
 * @template T
 * @param {T[]} list
 * @returns {T | undefined}
 */
function last(list) {
  return list[list.length - 1];
}

/**
 * @template {{ id: number }} T
 * @param {T[]} rows
 * @param {number} id
 * @returns {T | undefined}
 */
function byId(rows, id) {
  return rows.find(row => row.id === id);
}

/**
 * @template K, V
 * @param {K} key
 * @param {V} value
 * @returns {[K, V]}
 */
function pair(key, value) {
  return [key, value];
}

/**
 * @template T
 * @template {keyof T} K
 * @param {T} object
 * @param {K} key
 * @returns {T[K]}
 */
function pick(object, key) {
  return object[key];
}

/**
 * @template T
 * @template [U=T[]]
 * @typedef {{ one: T, many: U }} Both
 */

/** @type {Both<number>} */
const both = { one: 1, many: [1, 2] };

/** @type {Both<number, string>} */
const other = { one: 1, many: "many" };

/**
 * @template T
 */
class Box {
  /** @param {T} content */
  constructor(content) {
    /** @type {T} */
    this.content = content;
  }

  /** @returns {T} */
  get() {
    return this.content;
  }

  /**
   * @template U
   * @param {(content: T) => U} f
   * @returns {Box<U>}
   */
  map(f) {
    return new Box(f(this.content));
  }
}

/**
 * @template T
 * @extends {Box<T[]>}
 */
class Shelf extends Box {
  /** @returns {number} */
  size() {
    return this.content.length;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += same(i) + (last([i, 1]) ?? 0) + (byId([{ id: i, extra: "e" }], i)?.id ?? 0) + pair(i, "v")[0] + pick({ n: i, s: "s" }, "n") + new Box(i).map(n => n + 1).get();
}
console.log("2000 rounds: " + warm);
console.log(same("text").length, last(["a", "b"]), last([]), byId([{ id: 1, name: "n" }], 1)?.name, byId([], 1));
console.log(pair("k", 1).join(), pick({ n: 1, s: "s" }, "s").length, both.many.length, other.many.length);
console.log(new Box("ab").map(s => s.length).get(), new Shelf([1, 2, 3]).size(), new Shelf(["a"]).get().join(), JSON.stringify(new Box({ x: 1 })));

export {};
