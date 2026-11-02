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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v0 key="y"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]]|[[L_3]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|"circle"|"square" flags=[IsExpected]}
// CHECK-NEXT: SwitchString v2 strings=["circle", "square"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NarrowByField v0, v3 key="kind"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="r"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v5 key="r"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Mul v7, v9
// CHECK-NEXT: v11 = Integer integer=3
// CHECK-NEXT: v12 = Mul v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = NarrowByField v0, v14 key="kind"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="side"
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v16 key="side"
// CHECK-NEXT: v20 = Convert v19 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v21 = Mul v18, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="got"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
