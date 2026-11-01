import defer * as front from "./front.mjs";
console.log(
  Object.keys(front).join(),
  Object.values(front)
    .map(value => (value === Bun ? "Bun" : typeof value))
    .join(),
);
