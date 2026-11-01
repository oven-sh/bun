// `export * from` as TypeScript emits it for CommonJS, where the star binds a name that the code may also store to the same object, with other names stored behind the star. Then somebody looks at the object, each time in another way: the keys stand in the order in which plain Bun made them, and a bound name stays the getter of the star.
// COUNTER: StarsRecorded >= 1100
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
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
const leaf = require("./leaf.js");
const otherLeaf = require("./other-leaf.js");
const manyNames = require("./many-names.js");
const boundNames = ["one", "two", "four", "name40"];
function starOf(source) {
  const barrel = {};
  __exportStar(source, barrel);
  barrel.behind = "behind";
  return barrel;
}
function middleNameOfTheStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.two = "replaced";
  }
  return barrel;
}
function firstNameOfTheStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.one = "replaced";
  }
  return barrel;
}
function lastNameOfTheStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.three = "replaced";
  }
  return barrel;
}
function everyNameOfTheStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.three = "replaced";
    barrel.one = "replaced";
    barrel.two = "replaced";
  }
  return barrel;
}
function nothingBehindTheStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  if (really) {
    barrel.two = "replaced";
  }
  return barrel;
}
function threeNamesBehind(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  barrel.later = "later";
  barrel.latest = "latest";
  if (really) {
    barrel.two = "replaced";
  }
  return barrel;
}
function betweenTwoStars(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  __exportStar(otherLeaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.two = "replaced";
    barrel.four = "replaced";
  }
  return barrel;
}
function nameOfTheSecondStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  __exportStar(otherLeaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.five = "replaced";
  }
  return barrel;
}
function nameBothStarsHave(really) {
  const barrel = { __esModule: true };
  __exportStar(otherLeaf, barrel);
  barrel.late = "late";
  __exportStar(leaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.two = "replaced";
  }
  return barrel;
}
function aheadAndBehind(really) {
  const barrel = { __esModule: true };
  barrel.early = "early";
  __exportStar(leaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.two = "replaced";
    barrel.early = "replaced";
  }
  return barrel;
}
function behindTwoStars(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  __exportStar(otherLeaf, barrel);
  barrel.late = "late";
  if (really) {
    barrel.three = "replaced";
    barrel.four = "replaced";
  }
  return barrel;
}
function manyNamesInFront(really) {
  const barrel = { __esModule: true };
  __exportStar(manyNames, barrel);
  barrel.late = "late";
  __exportStar(leaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.name00 = "replaced";
    barrel.name40 = "replaced";
    barrel.name89 = "replaced";
    barrel.two = "replaced";
  }
  return barrel;
}
function manyNamesBehind(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  __exportStar(manyNames, barrel);
  barrel.last = "last";
  if (really) {
    barrel.name70 = "replaced";
    barrel.one = "replaced";
  }
  return barrel;
}
function sameStarTwice(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  __exportStar(leaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.two = "replaced";
  }
  return barrel;
}
function storedDeletedAndStoredAgain(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.late = "late";
  barrel.later = "later";
  delete barrel.late;
  __exportStar(otherLeaf, barrel);
  barrel.late = "late again";
  if (really) {
    barrel.two = "replaced";
    barrel.five = "replaced";
  }
  return barrel;
}
function deletedAndBoundByTheNextStar(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.four = "my four";
  barrel.late = "late";
  delete barrel.four;
  __exportStar(otherLeaf, barrel);
  barrel.last = "last";
  if (really) {
    barrel.one = "replaced";
  }
  return barrel;
}
function middle(really) {
  const barrel = { __esModule: true };
  __exportStar(leaf, barrel);
  barrel.middle = "middle";
  __exportStar(otherLeaf, barrel);
  barrel.end = "end";
  if (really) {
    barrel.two = "replaced";
    barrel.four = "replaced";
  }
  return barrel;
}
function outer(really) {
  const barrel = { __esModule: true };
  __exportStar(middle(false), barrel);
  barrel.outer = "outer";
  if (really) {
    barrel.four = "replaced";
    barrel.middle = "replaced";
  }
  return barrel;
}
function outermost(really) {
  const barrel = { __esModule: true };
  barrel.first = "first";
  __exportStar(outer(false), barrel);
  barrel.outermost = "outermost";
  __exportStar(middleNameOfTheStar(false), barrel);
  barrel.last = "last";
  if (really) {
    barrel.late = "replaced";
    barrel.one = "replaced";
    barrel.end = "replaced";
  }
  return barrel;
}
function plainBarrelOverSuchBarrels(really) {
  const barrel = { __esModule: true };
  __exportStar(middle(false), barrel);
  __exportStar(betweenTwoStars(false), barrel);
  if (really) {
  }
  return barrel;
}
function unmarkedMiddle(really) {
  const barrel = {};
  __exportStar(leaf, barrel);
  barrel.middle = "middle";
  __exportStar(otherLeaf, barrel);
  barrel.end = "end";
  if (really) {
    barrel.two = "replaced";
    barrel.four = "replaced";
  }
  return barrel;
}
function unmarkedOuter(really) {
  const barrel = {};
  __exportStar(unmarkedMiddle(false), barrel);
  barrel.outer = "outer";
  if (really) {
    barrel.four = "replaced";
    barrel.middle = "replaced";
  }
  return barrel;
}
function outerOverUnmarked(really) {
  const barrel = { __esModule: true };
  __exportStar(unmarkedOuter(false), barrel);
  barrel.outermost = "outermost";
  if (really) {
    barrel.two = "replaced";
    barrel.end = "replaced";
  }
  return barrel;
}
const makers = { middleNameOfTheStar, firstNameOfTheStar, lastNameOfTheStar, everyNameOfTheStar, nothingBehindTheStar, threeNamesBehind, betweenTwoStars, nameOfTheSecondStar, nameBothStarsHave, aheadAndBehind, behindTwoStars, manyNamesInFront, manyNamesBehind, sameStarTwice, storedDeletedAndStoredAgain, deletedAndBoundByTheNextStar, middle, outer, outermost, plainBarrelOverSuchBarrels, unmarkedMiddle, unmarkedOuter, outerOverUnmarked };
const looks = {
  "keys": b => Object.keys(b).join(),
  "for-in": b => listWithForIn(b),
  "spread": b => valuesOf({ ...b }),
  "json": b => JSON.stringify(b),
  "read-then-keys": b => [b.one, b.two, show(b.late), b.last, b.missing, Object.keys(b).join()].join(" "),
  "store-then-keys": b => [(b.added = "added"), Object.keys(b).join()].join(" "),
  "store-twice-then-keys": b => [(b.added = "added"), (b.more = "more"), b.two, Object.keys(b).join()].join(" "),
  "store-late-again": b => [attempt(() => (b.late = "late, stored again")), Object.keys(b).join()].join(" "),
  "store-bound-names-by-key": b => [...boundNames.map(name => attempt(() => (b[name] = "stored"))), Object.keys(b).join()].join(" "),
  "delete-late": b => [attempt(() => delete b.late), Object.keys(b).join(), (b.late = "back"), Object.keys(b).join()].join(" "),
  "delete-bound-names": b => [...boundNames.map(name => attempt(() => delete b[name])), Object.keys(b).join()].join(" "),
  "define-bound-names": b => [...boundNames.map(name => attempt(() => Reflect.defineProperty(b, name, { value: "defined" }))), Object.keys(b).join()].join(" "),
  "freeze": b => [Object.freeze(b) === b, Object.isFrozen(b), attempt(() => (b.late = 1)), Object.keys(b).join()].join(" "),
  "has": b => ["two" in b, "late" in b, Object.hasOwn(b, "four"), Object.hasOwn(b, "last"), Object.hasOwn(b, "two"), Object.keys(b).join()].join(" "),
  "descriptor": b => [Object.keys(Object.getOwnPropertyDescriptor(b, "two") ?? {}).join(), Object.keys(Object.getOwnPropertyDescriptor(b, "late") ?? {}).join()].join(" "),
  "assign-from": b => valuesOf(Object.assign({}, b)),
  "assign-to": b => valuesOf(Object.assign(b, { extra: "extra" })),
  "own-keys": b => Reflect.ownKeys(b).map(String).join(),
  "entries": b => Object.entries(b).map(([key, value]) => key + ":" + show(value)).join(),
  "rest": b => (({ two, late, ...rest }) => [two, late, valuesOf(rest)].join(" "))(b),
  "star-of-it": b => valuesOf(starOf(b)),
  "star-of-it-then-keys": b => [starOf(b).two, Object.keys(b).join()].join(" "),
};
for (const [name, look] of Object.entries(looks)) {
  console.log("--- " + name);
  for (const [shape, make] of Object.entries(makers)) {
    const barrel = make(false);
    console.log(shape, attempt(() => look(barrel)));
    console.log(shape, describe(barrel));
    console.log(shape, valuesOf(barrel));
  }
}
console.log("--- the names are stored after all");
for (const [shape, make] of Object.entries(makers)) console.log(shape, attempt(() => valuesOf(make(true))));
