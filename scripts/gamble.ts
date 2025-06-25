#!/usr/bin/env bun
// usage: bun scripts/gamble.ts <number of attempts> <timeout in seconds> <command>

import assert from "node:assert";

const attempts = parseInt(process.argv[2]);
const timeout = parseFloat(process.argv[3]);
const argv = process.argv.slice(4);

let numTimedOut = 0;
const signals = new Map<string, number>();
const codes = new Map<number, number>();
let numOk = 0;

for (let i = 0; i < attempts; i++) {
  const proc = Bun.spawn({
    cmd: argv,
    timeout: 1000 * timeout,
    stdin: null,
    stdout: "ignore",
    stderr: "pipe",
  });
  await proc.exited;
  const errors = await new Response(proc.stderr).text();

  const { signalCode: signal, exitCode } = proc;

  if (signal === "SIGTERM") {
    // sent for timeouts
    numTimedOut += 1;
  } else if (signal) {
    const newCount = 1 + (signals.get(signal) ?? 0);
    signals.set(signal, newCount);
  } else if (exitCode !== 0) {
    // if null there should have been a signal
    assert(exitCode !== null);
    const newCount = 1 + (codes.get(exitCode) ?? 0);
    codes.set(exitCode, newCount);
  } else {
    numOk += 1;
  }
  if (exitCode !== 0) console.log(errors);
  process.stdout.write(exitCode === 0 ? "." : "!");
}
process.stdout.write("\n");

const width = attempts.toString().length;
const pad = (num: number): string => num.toString().padStart(width, " ");
const green = (text: string) => console.log(`\x1b[32m${text}\x1b[0m`);
const red = (text: string) => console.log(`\x1b[31m${text}\x1b[0m`);

green(`${pad(numOk)}/${attempts} OK`);
if (numTimedOut > 0) {
  red(`${pad(numTimedOut)}/${attempts} timeout`);
}
for (const [signal, count] of signals.entries()) {
  red(`${pad(count)}/${attempts} ${signal}`);
}
for (const [code, count] of codes.entries()) {
  red(`${pad(count)}/${attempts} code ${code}`);
}

process.exit(numOk === attempts ? 0 : 1);
