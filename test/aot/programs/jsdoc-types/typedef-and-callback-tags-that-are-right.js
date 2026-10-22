/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {Point} home
 * @property {string[]} [tags]
 * @property {number | null} age
 */

/**
 * @typedef {Object} Nested
 * @property {object} inner
 * @property {number} inner.depth
 * @property {string} inner.label
 */

/** @typedef {"low" | "high"} Level */
/** @typedef {[number, string]} Pair */
/** @typedef {Record<string, Point>} Places */
/** @typedef {Point & { z: number }} Point3 */
/** @typedef {(n: number) => number} Step */

/**
 * @callback Reducer
 * @param {number} total
 * @param {Point} p
 * @returns {number}
 */

/**
 * @callback Visitor
 * @param {User} user
 * @param {number} [index]
 * @returns {void}
 */

/**
 * @param {Point[]} points
 * @param {Reducer} reducer
 * @returns {number}
 */
function reduce(points, reducer) {
  let total = 0;
  for (const p of points) total = reducer(total, p);
  return total;
}

/**
 * @param {User[]} users
 * @param {Visitor} visit
 */
function each(users, visit) {
  users.forEach((user, index) => visit(user, index));
}

/** @type {User} */
const first = { id: 1, name: "first", home: { x: 1, y: 2 }, age: null };

/** @type {User} */
const second = { id: 2, name: "second", home: { y: 4, x: 3 }, tags: ["a", "b"], age: 30 };

/** @type {Nested} */
const nested = { inner: { depth: 2, label: "deep" } };

/** @type {Level} */
let level = "low";

/** @type {Pair} */
const pair = [1, "one"];

/** @type {Places} */
const places = { home: { x: 1, y: 2 }, work: { x: 3, y: 4 } };

/** @type {Point3} */
const high = { x: 1, y: 2, z: 3 };

/** @type {Step} */
const up = n => n + 1;

/** @type {Reducer} */
const addX = (total, p) => total + p.x;

/**
 * @param {Level} l
 * @returns {number}
 */
function rank(l) {
  return l === "low" ? 1 : 2;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += reduce([first.home, second.home, high], addX) + up(i) + rank(level) + pair[0] + nested.inner.depth;
console.log("2000 rounds: " + warm);

/** @type {string[]} */
const seen = [];
each([first, second], (user, index) => {
  seen.push(index + ":" + user.name + ":" + (user.tags?.join("+") ?? "no tags") + ":" + (user.age ?? "no age"));
});
console.log(seen.join(" "));
level = "high";
console.log(rank(level), pair[1].length, Object.keys(places).join(), places.work.x + places.home.y, high.z);
console.log(JSON.stringify([first, second, nested, pair, high]));

export {};
