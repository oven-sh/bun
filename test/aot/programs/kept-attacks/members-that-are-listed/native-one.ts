// Members that are listed: native one. It prints what plain Bun prints.
import path from "node:path";
import { EventEmitter } from "node:events";

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

const timer = setTimeout(() => {}, 1 << 30);
function hasRef(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += timer.hasRef() ? 1 : 2;
  return sum;
}

const emitter = new EventEmitter();
function setMaxListeners(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += emitter.setMaxListeners(20) === emitter ? 1 : 2;
  return sum;
}

function nanoseconds(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += Bun.nanoseconds() > 0 ? 1 : 2;
  return sum;
}

const glob = new Bun.Glob("*.ts");
function match(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; ++i) sum += glob.match("a.ts") ? 1 : 2;
  return sum;
}

const cases: Record<string, (rounds: number) => number> = { none, isAbsolute, hasRef, setMaxListeners, nanoseconds, match };
const which = process.argv[2] ?? "none";
const rounds = Number(process.argv[3] ?? 1000);
console.log(which, rounds, cases[which](rounds));
clearTimeout(timer);
