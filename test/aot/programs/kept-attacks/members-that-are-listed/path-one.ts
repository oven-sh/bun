// Members that are listed: path one. It prints what plain Bun prints.
import path from "node:path";

function none(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += i & 1;
  return sum;
}

function isAbsolute(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += path.isAbsolute("/a") ? 1 : 2;
  return sum;
}

function join(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += path.join("a", "b").length;
  return sum;
}

function dirname(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += path.dirname("/a/b").length;
  return sum;
}

function basename(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += path.basename("/a/b").length;
  return sum;
}

function toNamespacedPath(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += path.toNamespacedPath("/a").length;
  return sum;
}

function held(rounds: number): number {
  const f = path.isAbsolute;
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += f("/a") ? 1 : 2;
  return sum;
}

const cases: Record<string, (rounds: number) => number> = { none, isAbsolute, join, dirname, basename, toNamespacedPath, held };
const which = process.argv[2] ?? "none";
const rounds = Number(process.argv[3] ?? 1000);
console.log(which, rounds, cases[which](rounds));
