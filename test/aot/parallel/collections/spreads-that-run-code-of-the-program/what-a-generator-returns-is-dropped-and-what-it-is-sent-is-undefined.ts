function* tells(): Generator<string, string, unknown> { const first = yield "a"; const second = yield "sent " + String(first); return "returned " + String(second); }
console.log([...tells()].join());
