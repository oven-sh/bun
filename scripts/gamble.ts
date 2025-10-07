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
const width = attempts.toString().length;
const pad = (num: number): string => num.toString().padStart(width, " ");
const green = (text: string) => console.log(`\x1b[32m${text}\x1b[0m`);
const red = (text: string) => console.log(`\x1b[31m${text}\x1b[0m`);
const formatTime = (ms: number): string => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const padNumber = (n: number) => n.toString().padStart(2, "0");

  return `${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`;
};
const start = Date.now();
let totalTimeEstimate = -1;

function report() {
  process.stdout.write("\n");
  const attemptsReached =
    numOk + numTimedOut + signals.values().reduce((a, b) => a + b, 0) + codes.values().reduce((a, b) => a + b, 0);

  green(`${pad(numOk)}/${attemptsReached} OK`);
  if (numTimedOut > 0) {
    red(`${pad(numTimedOut)}/${attemptsReached} timeout`);
  }
  for (const [signal, count] of signals.entries()) {
    red(`${pad(count)}/${attemptsReached} ${signal}`);
  }
  for (const [code, count] of codes.entries()) {
    red(`${pad(count)}/${attemptsReached} code ${code}`);
  }

  process.exit(numOk === attemptsReached ? 0 : 1);
}

process.on("SIGINT", report);

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
  let description: string;

  if (signal === "SIGTERM") {
    // sent for timeouts
    numTimedOut += 1;
    description = "timeout";
  } else if (signal) {
    const newCount = 1 + (signals.get(signal) ?? 0);
    signals.set(signal, newCount);
    description = signal;
  } else if (exitCode !== 0) {
    // if null there should have been a signal
    assert(exitCode !== null);
    const newCount = 1 + (codes.get(exitCode) ?? 0);
    codes.set(exitCode, newCount);
    description = `code ${exitCode}`;
  } else {
    description = "ok";
    numOk += 1;
  }
  if (exitCode !== 0) {
    red(" " + description);
    console.log(errors);
  }
  const now = Date.now();
  const currentTotalTimeEstimate = (now - start) / ((i + 1) / attempts);
  if (totalTimeEstimate < 0) {
    totalTimeEstimate = currentTotalTimeEstimate;
  } else {
    totalTimeEstimate = 0.8 * totalTimeEstimate + 0.2 * currentTotalTimeEstimate;
  }
  const remaining = totalTimeEstimate - (now - start);
  process.stdout.write(`\r\x1b[2K${pad(i + 1)}/${attempts} completed, ${formatTime(remaining)} remaining`);
}

report();
