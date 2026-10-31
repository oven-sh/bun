// `export * from` as TypeScript emits it for CommonJS, with `exports.name = ..` behind it in the same module. The star waits until somebody looks. Then the names stand in the order in which plain Bun made them: those of a star in front of a name that was stored behind it.
// COUNTER: StarsRecorded >= 240
// COUNTER: StarsCarriedOutLate >= 200
"use strict";
const show = value => (typeof value === "function" ? "function" : typeof value === "string" ? JSON.stringify(value) : String(value));
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      return `${String(key)}{${Object.keys(d).map(name => `${name}=${show(d[name])}`).join(" ")}}`;
    })
    .join(" ");
const valuesOf = object => Object.keys(object).map(key => `${key}=${show(object[key])}`).join(" ");
const attempt = work => {
  try {
    return show(work());
  } catch (error) {
    return `threw ${error.constructor.name}: ${error.message}`;
  }
};
const listWithForIn = object => {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
};
const collect = () => {
  if (typeof Bun === "object") Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 20000; i++) garbage.push({ i, text: "garbage " + i });
  if (typeof Bun === "object") Bun.gc(true);
  return garbage.length;
};
const short = text => text.replace(/name(\d\d)[^ ,]*[ ,](?=name)/g, "").replace(/get=function/g, "get");
const looks = [
  [
    "keys",
    b => Object.keys(b).join(),
    [
      ["one-name", () => require("./keys/one-name.js")],
      ["three-names", () => require("./keys/three-names.js")],
      ["between-two-stars", () => require("./keys/between-two-stars.js")],
      ["ahead-and-behind", () => require("./keys/ahead-and-behind.js")],
      ["behind-two-stars", () => require("./keys/behind-two-stars.js")],
      ["own-name-hides-a-name-of-the-star", () => require("./keys/own-name-hides-a-name-of-the-star.js")],
      ["default-behind-the-star", () => require("./keys/default-behind-the-star.js")],
      ["name-of-the-second-star-stored-first", () => require("./keys/name-of-the-second-star-stored-first.js")],
      ["same-star-twice", () => require("./keys/same-star-twice.js")],
      ["many-names-in-front", () => require("./keys/many-names-in-front.js")],
      ["many-names-behind", () => require("./keys/many-names-behind.js")],
      ["function-behind-the-star", () => require("./keys/function-behind-the-star.js")],
      ["declared-ahead-stored-behind", () => require("./keys/declared-ahead-stored-behind.js")],
      ["stored-deleted-and-stored-again", () => require("./keys/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./keys/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./keys/name-of-the-star-stored-behind-it.js")],
      ["name-of-the-star-stored-in-sloppy-code", () => require("./keys/name-of-the-star-stored-in-sloppy-code.js")],
      ["defined-behind-the-star", () => require("./keys/defined-behind-the-star.js")],
      ["middle", () => require("./keys/middle.js")],
      ["outer", () => require("./keys/outer.js")],
      ["outermost", () => require("./keys/outermost.js")],
      ["source-grows-behind-the-star-of-it", () => require("./keys/source-grows-behind-the-star-of-it.js")],
    ],
  ],
  [
    "for-in",
    b => listWithForIn(b),
    [
      ["one-name", () => require("./for-in/one-name.js")],
      ["three-names", () => require("./for-in/three-names.js")],
      ["between-two-stars", () => require("./for-in/between-two-stars.js")],
      ["ahead-and-behind", () => require("./for-in/ahead-and-behind.js")],
      ["behind-two-stars", () => require("./for-in/behind-two-stars.js")],
      ["own-name-hides-a-name-of-the-star", () => require("./for-in/own-name-hides-a-name-of-the-star.js")],
      ["default-behind-the-star", () => require("./for-in/default-behind-the-star.js")],
      ["name-of-the-second-star-stored-first", () => require("./for-in/name-of-the-second-star-stored-first.js")],
      ["same-star-twice", () => require("./for-in/same-star-twice.js")],
      ["many-names-in-front", () => require("./for-in/many-names-in-front.js")],
      ["many-names-behind", () => require("./for-in/many-names-behind.js")],
      ["function-behind-the-star", () => require("./for-in/function-behind-the-star.js")],
      ["declared-ahead-stored-behind", () => require("./for-in/declared-ahead-stored-behind.js")],
      ["stored-deleted-and-stored-again", () => require("./for-in/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./for-in/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./for-in/name-of-the-star-stored-behind-it.js")],
      ["name-of-the-star-stored-in-sloppy-code", () => require("./for-in/name-of-the-star-stored-in-sloppy-code.js")],
      ["defined-behind-the-star", () => require("./for-in/defined-behind-the-star.js")],
      ["middle", () => require("./for-in/middle.js")],
      ["outer", () => require("./for-in/outer.js")],
      ["outermost", () => require("./for-in/outermost.js")],
      ["source-grows-behind-the-star-of-it", () => require("./for-in/source-grows-behind-the-star-of-it.js")],
    ],
  ],
  [
    "spread",
    b => valuesOf({ ...b }),
    [
      ["one-name", () => require("./spread/one-name.js")],
      ["three-names", () => require("./spread/three-names.js")],
      ["between-two-stars", () => require("./spread/between-two-stars.js")],
      ["ahead-and-behind", () => require("./spread/ahead-and-behind.js")],
      ["behind-two-stars", () => require("./spread/behind-two-stars.js")],
      ["own-name-hides-a-name-of-the-star", () => require("./spread/own-name-hides-a-name-of-the-star.js")],
      ["default-behind-the-star", () => require("./spread/default-behind-the-star.js")],
      ["name-of-the-second-star-stored-first", () => require("./spread/name-of-the-second-star-stored-first.js")],
      ["same-star-twice", () => require("./spread/same-star-twice.js")],
      ["many-names-in-front", () => require("./spread/many-names-in-front.js")],
      ["many-names-behind", () => require("./spread/many-names-behind.js")],
      ["function-behind-the-star", () => require("./spread/function-behind-the-star.js")],
      ["declared-ahead-stored-behind", () => require("./spread/declared-ahead-stored-behind.js")],
      ["stored-deleted-and-stored-again", () => require("./spread/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./spread/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./spread/name-of-the-star-stored-behind-it.js")],
      ["name-of-the-star-stored-in-sloppy-code", () => require("./spread/name-of-the-star-stored-in-sloppy-code.js")],
      ["defined-behind-the-star", () => require("./spread/defined-behind-the-star.js")],
      ["middle", () => require("./spread/middle.js")],
      ["outer", () => require("./spread/outer.js")],
      ["outermost", () => require("./spread/outermost.js")],
      ["source-grows-behind-the-star-of-it", () => require("./spread/source-grows-behind-the-star-of-it.js")],
    ],
  ],
  [
    "json",
    b => JSON.stringify(b),
    [
      ["one-name", () => require("./json/one-name.js")],
      ["three-names", () => require("./json/three-names.js")],
      ["between-two-stars", () => require("./json/between-two-stars.js")],
      ["ahead-and-behind", () => require("./json/ahead-and-behind.js")],
      ["behind-two-stars", () => require("./json/behind-two-stars.js")],
      ["own-name-hides-a-name-of-the-star", () => require("./json/own-name-hides-a-name-of-the-star.js")],
      ["default-behind-the-star", () => require("./json/default-behind-the-star.js")],
      ["name-of-the-second-star-stored-first", () => require("./json/name-of-the-second-star-stored-first.js")],
      ["same-star-twice", () => require("./json/same-star-twice.js")],
      ["many-names-in-front", () => require("./json/many-names-in-front.js")],
      ["many-names-behind", () => require("./json/many-names-behind.js")],
      ["function-behind-the-star", () => require("./json/function-behind-the-star.js")],
      ["declared-ahead-stored-behind", () => require("./json/declared-ahead-stored-behind.js")],
      ["stored-deleted-and-stored-again", () => require("./json/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./json/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./json/name-of-the-star-stored-behind-it.js")],
      ["name-of-the-star-stored-in-sloppy-code", () => require("./json/name-of-the-star-stored-in-sloppy-code.js")],
      ["defined-behind-the-star", () => require("./json/defined-behind-the-star.js")],
      ["middle", () => require("./json/middle.js")],
      ["outer", () => require("./json/outer.js")],
      ["outermost", () => require("./json/outermost.js")],
      ["source-grows-behind-the-star-of-it", () => require("./json/source-grows-behind-the-star-of-it.js")],
    ],
  ],
  [
    "read-then-keys",
    b => [b.one, show(b.late), b.last, b.missing, Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./read-then-keys/one-name.js")],
      ["between-two-stars", () => require("./read-then-keys/between-two-stars.js")],
      ["many-names-in-front", () => require("./read-then-keys/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./read-then-keys/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./read-then-keys/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./read-then-keys/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./read-then-keys/defined-behind-the-star.js")],
      ["middle", () => require("./read-then-keys/middle.js")],
      ["outer", () => require("./read-then-keys/outer.js")],
      ["outermost", () => require("./read-then-keys/outermost.js")],
    ],
  ],
  [
    "store-then-keys",
    b => [(b.added = "added"), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./store-then-keys/one-name.js")],
      ["between-two-stars", () => require("./store-then-keys/between-two-stars.js")],
      ["many-names-in-front", () => require("./store-then-keys/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./store-then-keys/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./store-then-keys/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./store-then-keys/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./store-then-keys/defined-behind-the-star.js")],
      ["middle", () => require("./store-then-keys/middle.js")],
      ["outer", () => require("./store-then-keys/outer.js")],
      ["outermost", () => require("./store-then-keys/outermost.js")],
    ],
  ],
  [
    "store-late-again",
    b => [attempt(() => (b.late = "late, stored again")), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./store-late-again/one-name.js")],
      ["between-two-stars", () => require("./store-late-again/between-two-stars.js")],
      ["many-names-in-front", () => require("./store-late-again/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./store-late-again/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./store-late-again/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./store-late-again/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./store-late-again/defined-behind-the-star.js")],
      ["middle", () => require("./store-late-again/middle.js")],
      ["outer", () => require("./store-late-again/outer.js")],
      ["outermost", () => require("./store-late-again/outermost.js")],
    ],
  ],
  [
    "delete-late",
    b => [attempt(() => delete b.late), Object.keys(b).join(), (b.late = "back"), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./delete-late/one-name.js")],
      ["between-two-stars", () => require("./delete-late/between-two-stars.js")],
      ["many-names-in-front", () => require("./delete-late/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./delete-late/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./delete-late/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./delete-late/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./delete-late/defined-behind-the-star.js")],
      ["middle", () => require("./delete-late/middle.js")],
      ["outer", () => require("./delete-late/outer.js")],
      ["outermost", () => require("./delete-late/outermost.js")],
    ],
  ],
  [
    "delete-one",
    b => [attempt(() => delete b.one), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./delete-one/one-name.js")],
      ["between-two-stars", () => require("./delete-one/between-two-stars.js")],
      ["many-names-in-front", () => require("./delete-one/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./delete-one/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./delete-one/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./delete-one/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./delete-one/defined-behind-the-star.js")],
      ["middle", () => require("./delete-one/middle.js")],
      ["outer", () => require("./delete-one/outer.js")],
      ["outermost", () => require("./delete-one/outermost.js")],
    ],
  ],
  [
    "freeze",
    b => [Object.freeze(b) === b, Object.isFrozen(b), attempt(() => (b.late = 1)), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./freeze/one-name.js")],
      ["between-two-stars", () => require("./freeze/between-two-stars.js")],
      ["many-names-in-front", () => require("./freeze/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./freeze/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./freeze/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./freeze/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./freeze/defined-behind-the-star.js")],
      ["middle", () => require("./freeze/middle.js")],
      ["outer", () => require("./freeze/outer.js")],
      ["outermost", () => require("./freeze/outermost.js")],
    ],
  ],
  [
    "has",
    b => ["one" in b, "late" in b, Object.hasOwn(b, "five"), Object.hasOwn(b, "last"), Object.keys(b).join()].join(" "),
    [
      ["one-name", () => require("./has/one-name.js")],
      ["between-two-stars", () => require("./has/between-two-stars.js")],
      ["many-names-in-front", () => require("./has/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./has/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./has/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./has/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./has/defined-behind-the-star.js")],
      ["middle", () => require("./has/middle.js")],
      ["outer", () => require("./has/outer.js")],
      ["outermost", () => require("./has/outermost.js")],
    ],
  ],
  [
    "index",
    b => ((b[1] = "index"), Reflect.ownKeys(b).map(String).join()),
    [
      ["one-name", () => require("./index/one-name.js")],
      ["between-two-stars", () => require("./index/between-two-stars.js")],
      ["many-names-in-front", () => require("./index/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./index/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./index/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./index/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./index/defined-behind-the-star.js")],
      ["middle", () => require("./index/middle.js")],
      ["outer", () => require("./index/outer.js")],
      ["outermost", () => require("./index/outermost.js")],
    ],
  ],
  [
    "collected",
    b => (collect(), Object.keys(b).join()),
    [
      ["one-name", () => require("./collected/one-name.js")],
      ["between-two-stars", () => require("./collected/between-two-stars.js")],
      ["many-names-in-front", () => require("./collected/many-names-in-front.js")],
      ["stored-deleted-and-stored-again", () => require("./collected/stored-deleted-and-stored-again.js")],
      ["deleted-and-bound-by-the-next-star", () => require("./collected/deleted-and-bound-by-the-next-star.js")],
      ["name-of-the-star-stored-behind-it", () => require("./collected/name-of-the-star-stored-behind-it.js")],
      ["defined-behind-the-star", () => require("./collected/defined-behind-the-star.js")],
      ["middle", () => require("./collected/middle.js")],
      ["outer", () => require("./collected/outer.js")],
      ["outermost", () => require("./collected/outermost.js")],
    ],
  ],
];
for (const [name, look, barrels] of looks) {
  console.log("--- " + name);
  for (const [file, load] of barrels) {
    const barrel = load();
    console.log(file, short(attempt(() => look(barrel))));
    console.log(file, short(describe(barrel)));
    console.log(file, short(valuesOf(barrel)));
  }
}
