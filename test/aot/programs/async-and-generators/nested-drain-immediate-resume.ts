// An async function that was resumed directly by the function it awaited, with no trip through the microtask queue, drains the queue itself: every async function that finishes inside the nested drain resumes its awaiter before drainMicrotasks() returns, as in plain Bun.
import { drainMicrotasks } from "bun:jsc";

type Start = (label: string) => Promise<string>;
const log: string[] = [];

function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}
async function finishesAfterTimer(): Promise<void> {
  await afterTimer();
}
async function finishesAfterOneJob(label: string): Promise<string> {
  await null;
  log.push(label + ": callee finishes");
  return label;
}

async function awaitsVariable(label: string): Promise<string> {
  const pending = finishesAfterOneJob(label);
  const result = await pending;
  log.push(label + ": awaiter resumed");
  return result;
}
async function awaitsCall(label: string): Promise<string> {
  const result = await finishesAfterOneJob(label);
  log.push(label + ": awaiter resumed");
  return result;
}
async function awaitsChain(label: string, depth: number): Promise<string> {
  const pending = depth ? awaitsChain(label, depth - 1) : finishesAfterOneJob(label);
  const result = await pending;
  log.push(label + ": awaiter " + depth + " resumed");
  return result;
}

// The timer's job finds an empty queue, so finishesAfterTimer() resumes its only awaiter directly.
async function drains(label: string, start: Start): Promise<void> {
  const pending = finishesAfterTimer();
  await pending;
  log.push(label + ": starts");
  void start(label).then(result => log.push(result + ": settled"));
  drainMicrotasks();
  log.push(label + ": drained");
}
async function doesNotDrain(label: string, start: Start): Promise<void> {
  const pending = finishesAfterTimer();
  await pending;
  log.push(label + ": starts");
  void start(label).then(result => log.push(result + ": settled"));
  log.push(label + ": returns");
}

const starts: [string, Start][] = [
  ["variable", awaitsVariable],
  ["call", awaitsCall],
  ["chain", label => awaitsChain(label, 3)],
];

async function main(): Promise<void> {
  for (const [name, start] of starts) {
    for (const run of [drains, doesNotDrain]) {
      const label = run.name + ", " + name;
      const pending = run(label, start);
      await pending;
      log.push(label + ": caller resumed");
      await afterTimer();
    }
  }
  console.log(log.join("\n"));
}
void main();
