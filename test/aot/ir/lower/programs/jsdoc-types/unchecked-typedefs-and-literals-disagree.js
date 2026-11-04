// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {Point} home
 * @property {string[]} tags
 */

/** @typedef {{ kind: "circle", r: number } | { kind: "square", side: number }} Shape */

/** @param {Point} p */
function sum(p) {
  return p.x + p.y;
}

/** @param {User} u */
function describe(u) {
  return [u.id + 1, u.name + "!", sum(u.home), u.tags.length];
}

/**
 * @param {Shape} s
 * @returns {number}
 */
function area(s) {
  switch (s.kind) {
    case "circle":
      return s.r * s.r * 3;
    case "square":
      return s.side * s.side;
  }
}

/** @type {Point} */
const honest = { x: 1, y: 2 };

/** @type {Point} */
const texts = { x: "1", y: "2" };

/** @type {Point} */
const wide = { w: 0, x: 1, y: 2, z: 3 };

/** @type {Point} */
const narrow = { x: 1 };

/** @type {Point} */
const other = { a: 1, b: 2 };

/** @type {Point} */
const accessors = {
  get x() {
    return "got";
  },
  set y(value) {},
};

/** @type {Point} */
const methods = {
  x() {
    return 1;
  },
  y: () => 2,
};

/** @type {Point} */
const computed = { ["x"]: "computed", ["y" + ""]: 2 };

/** @type {Point} */
const spread = { x: 1, y: 2, ...{ x: "spread" } };

/** @type {Point} */
const twice = { x: 1, y: 2, x: "again" };

/** @type {Point} */
const proto = { __proto__: { x: "inherited" }, y: 2 };

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(honest) + sum({ x: i, y: 1 }) + area({ kind: "circle", r: 1 }) + area({ kind: "square", side: i });
console.log("2000 honest rounds: " + warm);

for (const [name, p] of Object.entries({ honest, texts, wide, narrow, other, accessors, methods, computed, spread, twice, proto })) {
  attempt(name, () => [p.x, p.y, typeof p.x, sum(p), Object.keys(p).join(), JSON.stringify(p)]);
  attempt(name + ", stored to", () => {
    p.x = 5;
    p.y = 6;
    return [sum(p), Object.keys(p).join()];
  });
}

attempt("a user as declared", () => describe({ id: 1, name: "n", home: { x: 1, y: 2 }, tags: ["t"] }));
attempt("a user in another order", () => describe({ tags: ["t"], home: { y: 2, x: 1 }, name: "n", id: 1 }));
attempt("a user of other kinds", () => describe({ id: "1", name: 5, home: [1, 2], tags: "tt" }));
attempt("a user without a home", () => describe({ id: 1, name: "n", tags: [] }));
attempt("a user without tags", () => describe({ id: 1, name: "n", home: { x: 1, y: 2 } }));

attempt("shapes", () => [area({ kind: "circle", r: 1 }), area({ kind: "triangle" }), area({ kind: "circle" }), area({ kind: "square", r: 1 }), area({}), area({ kind: "circle", r: "2" }), area("circle")]);
attempt("no shape", () => area(null));
attempt("what falls off the end is used", () => [area({ kind: "oval" }) + 1, typeof area({ kind: "oval" })]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: sum area x y
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]]|[[L_3]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]|[[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: SwitchString v1 strings=["circle", "square"] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: v4 = PropGet v3 key="r"
// CHECK-NEXT: v5 = PropGet v3 key="r"
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Integer integer=3
// CHECK-NEXT: v8 = Mul v6, v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NarrowByField v0, v9 key="kind"
// CHECK-NEXT: v11 = PropGet v10 key="side"
// CHECK-NEXT: v12 = PropGet v10 key="side"
// CHECK-NEXT: v13 = Mul v11, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="got"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
