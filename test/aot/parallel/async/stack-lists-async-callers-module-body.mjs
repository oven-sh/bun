// A function is resumed by a drain of the jobs, and what called the drain was itself resumed by a drain: a module body, or an async function. The stack lists the same async callers as in plain Bun.
import { drainMicrotasks } from "bun:jsc";

function frames() {
  return (new Error().stack ?? "")
    .split("\n")
    .map(line => /at (async )?(inner|outer|middle|top|job)\b/.exec(line))
    .filter(match => match !== null)
    .map(match => (match[1] ? "async " : "") + match[2])
    .join(", ");
}
async function inner(label) {
  await undefined;
  console.log(label + ":", frames());
}
async function outer(label) {
  await inner(label);
}
function gateOpenedInAJobThatDrains() {
  let open;
  const gate = new Promise(resolve => {
    open = resolve;
  });
  queueMicrotask(function job() {
    open(0);
    drainMicrotasks();
  });
  return gate;
}

{
  const kept = outer("the module body drains");
  drainMicrotasks();
  await kept;
}
{
  await gateOpenedInAJobThatDrains();
  const kept = outer("the module body is resumed by a drain, and drains");
  drainMicrotasks();
  await kept;
}

async function middle(label, gate) {
  await gate;
  const kept = outer(label);
  drainMicrotasks();
  await kept;
}
async function top(label, gate) {
  await middle(label, gate);
}
await top("an async function drains", Promise.resolve(0));
await top("an async function is resumed by a drain, and drains", gateOpenedInAJobThatDrains());
{
  await gateOpenedInAJobThatDrains();
  await top("both", gateOpenedInAJobThatDrains());
}
