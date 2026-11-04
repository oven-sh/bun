// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: reduce each rank up
// CHECK-LABEL: function {{*}}name="reduce"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}, {type=undefined|null|[[f_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1(v3)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v10 = Call v1, -, v5, v9 calleeName="reducer"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v11)
// CHECK-NEXT: b5() role=IterationCleanup subject=v4:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_3]]> flags=[IsExpected]}, {type=undefined|null|[[f_4]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_3]]>, v1: undefined|null|[[f_4]]):
// CHECK-NEXT: v2 = PropGet v0 key="forEach"
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_5]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="forEach" calleeName="users.forEach"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rank"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"high"|"low" flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|"high"|"low"):
// CHECK-NEXT: v1 = String string="low"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="up"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
