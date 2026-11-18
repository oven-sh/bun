// Code that several instances of a module share

function expect(actual, expected) {
  if (show(actual) !== show(expected)) throw new Error(`${show(actual)} instead of ${show(expected)}`);
}

const main = `
  import { count, step, twice } from "other";
  function local(n) { return n + 1; }
  export { step };
  export function read() { return count; }
  export function sum(n) { let all = 0; for (let i = 0; i < n; i++) all += count + twice(i) + local(i); return all; }
  export function stepping(n) { let all = 0; for (let i = 0; i < n; i++) { all += count; step(); } return all; }`;
const other = (start, before = "") =>
  `${before} export let count = ${start}; export function step() { count++; } export function twice(n) { return 2 * n; }`;

const all = [];
for (let number = 0; number < 12; number++) {
  // The last ones have the variable in another slot.
  const before = number < 8 ? "" : `export let ${"abcd".slice(0, number - 7).split("").map(it => `${it} = -1`)};`;
  all.push({ module: instantiate({ main, other: other(number % 2 * 100, before) }), count: number % 2 * 100 });
  for (let turn = 0; turn < 30; turn++) {
    for (const it of all) {
      expect(it.module.sum(4), 4 * it.count + 12 + 10);
      expect(it.module.read(), it.count);
      expect(it.module.stepping(3), 3 * it.count + 3);
      it.count += 3;
    }
  }
}

// What is read too early

const cycle = () => ({
  main: `import "other"; export let late = 5; export { attempt } from "other"; export function own() { try { return late; } catch (e) { return e.name; } }`,
  other: `import { late, own } from "main";
    export function attempt() { try { return [late, own()]; } catch (e) { return [e.name, own()]; } }
    globalThis.seen = []; for (let i = 0; i < globalThis.early; i++) seen.push(attempt());`,
});
for (const early of [0, 0, 0, 3, 300, 0]) {
  globalThis.early = early;
  const { attempt } = instantiate(cycle());
  expect(seen, Array(early).fill(["ReferenceError", "ReferenceError"]));
  for (let turn = 0; turn < 100; turn++) expect(attempt(), [5, 5]);
}
