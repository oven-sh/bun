// The microtask queue calls a bound function through its host function, not through the interpreter's or compiled code's own unwrapping.
// Forty binds on every road, so that the later ones are made by compiled code itself; targets with and without captured variables, arrows, methods and bound functions.
const lines = [];
const context = { name: "context" };
function report(id, value) {
  lines.push(this.name + " " + id + " " + value);
}
function reportNothingBound(value) {
  lines.push((this === undefined ? "undefined" : this.name) + " " + value);
}
function makeCounter(start) {
  let count = start;
  return function (step, value) {
    count += step;
    lines.push(this.name + " counter " + count + " " + value);
  };
}
const holder = {
  name: "holder",
  method(id, value) {
    lines.push(this.name + " method " + id + " " + value);
  },
};
const arrow = (id, value) => {
  lines.push("arrow " + id + " " + value);
};
const counter = makeCounter(100);

const waits = [];
for (let i = 0; i < 40; i++) {
  waits.push(Promise.resolve(i).then(report.bind(context, "then" + i)));
  waits.push(Promise.reject(i).catch(report.bind(context, "catch" + i)));
  waits.push(Promise.resolve(i).finally(report.bind(context, "finally" + i)));
  waits.push(Promise.resolve(i).then(reportNothingBound.bind(context)));
  waits.push(Promise.resolve(i).then(counter.bind(context, i)));
  waits.push(Promise.resolve(i).then(holder.method.bind(holder, i)));
  waits.push(Promise.resolve(i).then(arrow.bind(null, i)));
  waits.push(Promise.resolve(i).then(report.bind(context).bind(null, "twice" + i)));
  queueMicrotask(report.bind(context, "queued" + i, "-"));
}
await Promise.all(waits);

function settle(id, resolve) {
  lines.push(this.name + " thenable " + id);
  resolve(id * 2);
}
for (let i = 0; i < 40; i++) lines.push("awaited " + (await { then: settle.bind(context, i) }));

class Failure extends Error {}
function fail(id) {
  throw new Failure(this.name + " " + id);
}
for (let i = 0; i < 20; i++) {
  try {
    await Promise.resolve(i).then(fail.bind(context, i));
  } catch (error) {
    lines.push("caught " + (error instanceof Failure) + " " + error.message);
  }
}

console.log(lines.length);
console.log(lines.slice(0, 12).join("\n"));
console.log(lines.slice(-6).join("\n"));
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(sum);
