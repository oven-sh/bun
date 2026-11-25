// Outside of `bun test`, `Bun.jest` takes anything and answers the module of the runner. What stands behind the path asks nothing of it: map() hands an index and the list.
const path = "/made/up/gauge.js";
console.log(
  typeof Bun.jest(path),
  typeof Bun.jest(path, 1),
  typeof Bun.jest(path, 0, 1),
  typeof Bun.jest(path, true, true),
);
console.log(
  [path]
    .map(Bun.jest)
    .map(module => typeof module.expect)
    .join(),
);
