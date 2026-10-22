function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Cart {
  constructor(items, total) {
    this.items = items;
    this.total = total;
  }
  average() {
    return this.total / this.items;
  }
}

function OldCart(items, total) {
  this.items = items;
  this.total = total;
}
OldCart.prototype.average = function () {
  return this.total / this.items;
};

async function readAwaitRead(cart, pause) {
  const before = cart.total;
  await pause;
  return [before, cart.total];
}

async function callAwaitCall(cart, pause) {
  const before = cart.average();
  await pause;
  return [before, cart.average()];
}

async function storeAwaitStore(cart, pause) {
  cart.total = 1;
  await pause;
  cart.total = 2;
  return cart.total;
}

async function readInALoopOfAwaits(cart, pause) {
  const seen = [];
  for (let i = 0; i < 3; i++) {
    seen.push(cart.total);
    await pause;
  }
  return seen;
}

function* readYieldRead(cart) {
  const before = cart.total;
  yield "paused";
  return [before, cart.total];
}

function* callYieldCall(cart) {
  const before = cart.average();
  yield "paused";
  return [before, cart.average()];
}

async function* readYieldReadAsync(cart) {
  const before = cart.total;
  yield "paused";
  return [before, cart.total];
}

const changes = [
  ["nothing", () => {}],
  ["stores a string", cart => { cart.total = "changed"; }],
  ["stores 0.5", cart => { cart.total = 0.5; }],
  ["deletes total", cart => { delete cart.total; }],
  ["turns total into a getter", cart => { Object.defineProperty(cart, "total", { get: () => "got", configurable: true }); }],
  ["freezes it", cart => { Object.freeze(cart); }],
  ["gives it its own average", cart => { cart.average = () => "own average"; }],
  ["moves it under another prototype", cart => { Object.setPrototypeOf(cart, { average: () => "another average" }); }],
  ["removes its prototype", cart => { Object.setPrototypeOf(cart, null); }],
];

async function settle(run) {
  try {
    return show(await run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

const forms = [
  ["read, await, read", (cart, change) => { const result = readAwaitRead(cart, null); change(cart); return result; }],
  ["average(), await, average()", (cart, change) => { const result = callAwaitCall(cart, null); change(cart); return result; }],
  ["store, await, store", (cart, change) => { const result = storeAwaitStore(cart, null); change(cart); return result; }],
  ["three reads with awaits between", (cart, change) => { const result = readInALoopOfAwaits(cart, null); change(cart); return result; }],
  ["await of a thenable that changes it", (cart, change) => readAwaitRead(cart, { then(resolve) { change(cart); resolve(); } })],
  ["read, yield, read", (cart, change) => { const steps = readYieldRead(cart); steps.next(); change(cart); return steps.next().value; }],
  ["average(), yield, average()", (cart, change) => { const steps = callYieldCall(cart); steps.next(); change(cart); return steps.next().value; }],
  ["read, yield, read in an async generator", async (cart, change) => { const steps = readYieldReadAsync(cart); await steps.next(); change(cart); return (await steps.next()).value; }],
];

const kinds = [
  ["class", () => new Cart(2, 10)],
  ["constructor function", () => new OldCart(2, 10)],
];

for (let i = 0; i < 500; i++) for (const [, make] of kinds) for (const [, form] of forms) await form(make(), changes[0][1]);

for (const [kind, make] of kinds) {
  for (const [formLabel, form] of forms) {
    for (const [changeLabel, change] of changes) {
      console.log(kind + " | " + formLabel + " | " + changeLabel + " -> " + (await settle(() => form(make(), change))));
    }
  }
}
