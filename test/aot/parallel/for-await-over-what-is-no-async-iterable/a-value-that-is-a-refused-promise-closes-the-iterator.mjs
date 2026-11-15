// Under: --aot-testing=CheckProofsAtRunTime: what a step of the wrapped iterator answers is held against what its row says
const log = [];
const steps = {
  [Symbol.iterator]() { return this; },
  next() { return { value: Promise.reject(new RangeError("too far")), done: false }; },
  return() { log.push("closed"); return {}; },
};
try { for await (const item of steps) log.push(item); } catch (error) { log.push(error.name, error.message, error instanceof RangeError); }
async function* relay() { yield* steps; }
const step = relay().next();
console.log(step instanceof Promise);
try { await step; } catch (error) { log.push(error.message); }
const refusing = { then(keep, refuse) { refuse({ odd: "reason" }); } };
const other = { [Symbol.iterator]() { return this; }, next() { return { value: refusing, done: false }; }, return() { log.push("closed too"); return {}; } };
try { for await (const item of other) log.push(item); } catch (reason) { log.push(reason.odd); }
console.log(log.join());
