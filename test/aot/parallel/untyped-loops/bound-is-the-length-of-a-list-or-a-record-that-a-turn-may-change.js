// Loops up to `queue.length`, where the queue is a list or a record with a length and nobody could follow it to the loop.
// In some of them no turn changes the length, in the others a turn changes it: by name, through another name for the same object, by a push, in a call, or by taking the field away.
let sink;
const log = [];
class Item {
  constructor(value) {
    this.flag = true;
    this.value = value;
  }
}
function total(item, queue, turns) {
  let sum = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) sum += item.value;
  return sum;
}
function lastTurns(item, queue, from) {
  let sum = 0;
  for (let i = from; i < queue.length; i++) sum += item.value;
  return sum;
}
function cutShort(item, queue, turns) {
  let sum = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    if (i === 2) queue.length = 5;
  }
  return sum;
}
function cutShortThroughAnotherName(item, queue, other, turns) {
  let sum = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    if (i === 2) other.length = 5;
  }
  return sum;
}
function grown(item, queue) {
  let sum = 0;
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    if (i < 3) queue.push(i);
  }
  return sum;
}
function changedInCall(item, queue, turns, change) {
  let sum = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    if (i === 3) change(queue, item);
  }
  return sum;
}
function valueStoredThroughAnotherName(item, other, queue, turns) {
  let sum = 0;
  queue.length = turns;
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    if (i === 1) other.value = 100;
  }
  return sum;
}
function queueOfEachTurn(item, queues) {
  let sum = 0;
  let queue = queues[0];
  for (let i = 0; i < queue.length; i++) {
    sum += item.value;
    queue = queues[i & 1];
  }
  return sum;
}
function attempt(name, run) {
  try {
    log.push(name + ": " + String(run()));
  } catch (error) {
    log.push(name + ": " + error.constructor.name);
  }
}
const hidden = process.env.NAMES_OF_THIS_TEST ?? "";
sink = { total, lastTurns, cutShort, cutShortThroughAnotherName, grown, changedInCall, valueStoredThroughAnotherName, queueOfEachTurn };
const call = (name, ...operands) => sink[name + hidden](...operands);

const record = length => ({ length });
const list = length => new Array(length).fill(0);
const makers = { record, list };

for (let round = 0; round < 3; round++) {
  for (const [kind, make] of Object.entries(makers)) {
    for (const turns of [1000, 7, 1, 0]) attempt(`total of a ${kind} of ${turns}`, () => call("total", new Item(3), make(0), turns));
    attempt(`a ${kind} cut short`, () => call("cutShort", new Item(3), make(0), 9));
    attempt(`a ${kind} cut short through another name`, () => {
      const queue = make(0);
      return call("cutShortThroughAnotherName", new Item(3), queue, queue, 9);
    });
    attempt(`a ${kind} beside another that is cut short`, () => call("cutShortThroughAnotherName", new Item(3), make(0), make(0), 9));
    attempt(`a ${kind} beside one of the other kind that is cut short`, () => call("cutShortThroughAnotherName", new Item(3), make(0), kind === "list" ? record(0) : list(0), 9));
    attempt(`a ${kind} made longer in a call`, () => call("changedInCall", new Item(3), make(0), 6, queue => void (queue.length = 8)));
    attempt(`a ${kind} made shorter in a call`, () => call("changedInCall", new Item(3), make(0), 6, queue => void (queue.length = 0)));
    attempt(`a ${kind} beside an item that changes in a call`, () => call("changedInCall", new Item(3), make(0), 6, (queue, item) => void (item.value = 0.5)));
    attempt(`a ${kind} beside an item that loses its value in a call`, () => call("changedInCall", new Item(3), make(0), 6, (queue, item) => void delete item.value));
    attempt(`a ${kind} beside an item stored to through another name`, () => {
      const item = new Item(3);
      return call("valueStoredThroughAnotherName", item, item, make(0), 4);
    });
    attempt(`a ${kind} beside an item while another is stored to`, () => call("valueStoredThroughAnotherName", new Item(3), new Item(4), make(0), 4));
  }
  attempt("a list that grows", () => call("grown", new Item(3), list(2)));
  attempt("a record with a push that grows", () => call("grown", new Item(3), { length: 2, push() { this.length++; } }));
  attempt("a record that loses its length in a call", () => call("changedInCall", new Item(3), record(0), 6, queue => void delete queue.length));
  attempt("a record that gets a getter in a call", () => {
    let reads = 0;
    const sum = call("changedInCall", new Item(3), record(0), 6, queue => void Object.defineProperty(queue, "length", { get: () => (++reads, 9) }));
    return `${sum} behind ${reads} reads`;
  });
  attempt("a record whose length becomes a text in a call", () => call("changedInCall", new Item(3), record(0), 6, queue => void (queue.length = "7")));
  attempt("a record whose length becomes an object in a call", () => call("changedInCall", new Item(3), record(0), 6, queue => void (queue.length = { valueOf: () => 5 })));
  attempt("a list and a record in turns", () => call("queueOfEachTurn", new Item(3), [list(6), record(4)]));
  attempt("a record and a list in turns", () => call("queueOfEachTurn", new Item(3), [record(6), list(9)]));

  for (const length of [2.5, -1, -0, NaN, Infinity, 2 ** 31 + 1, 2 ** 32 + 1, 2 ** 53, "4", null, undefined, true, 3n, { valueOf: () => 2 }]) {
    const from = typeof length === "number" && length > 100 && length < Infinity ? length - 3 : length === Infinity ? Infinity : 0;
    attempt(`the last turns up to ${typeof length} ${typeof length === "object" && length ? "with valueOf" : Object.is(length, -0) ? "-0" : String(length)}`, () => call("lastTurns", new Item(3), record(length), from));
  }
  attempt("the last turns of a long list", () => call("lastTurns", new Item(3), new Array(2 ** 32 - 1), 2 ** 32 - 4));
  for (const value of [0.5, 2 ** 31, -0, "a", undefined, 2n, { valueOf: () => 4 }]) {
    for (const [kind, make] of Object.entries(makers)) attempt(`total of a ${kind} with ${typeof value} ${typeof value === "object" ? "with valueOf" : String(value)}`, () => call("total", new Item(value), make(0), 3));
  }
}
console.log(log.join("\n"));
