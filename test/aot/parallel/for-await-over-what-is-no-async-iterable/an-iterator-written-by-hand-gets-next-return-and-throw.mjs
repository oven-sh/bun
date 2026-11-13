const log = [];
const steps = {
  count: 0,
  [Symbol.iterator]() { return this; },
  next(sent) { log.push(`next ${sent}`); return { value: ++this.count, done: this.count > 3 }; },
  return(sent) { log.push(`return ${sent}`); return { value: "left", done: true }; },
  throw(sent) { log.push(`throw ${sent}`); return { value: "caught", done: false }; },
};
async function* relay() { const last = yield* steps; log.push(`last ${last}`); }
const stream = relay();
console.log(JSON.stringify(await stream.next("a")), JSON.stringify(await stream.next("b")));
console.log(JSON.stringify(await stream.throw("c")), JSON.stringify(await stream.return("d")));
console.log(log.join(" | "));
