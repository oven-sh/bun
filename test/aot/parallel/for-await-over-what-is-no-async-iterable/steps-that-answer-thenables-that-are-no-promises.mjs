// Under: --aot-testing=CheckProofsAtRunTime: what a step of the wrapped iterator answers is held against what its row says
const log = [];
const later = value => ({ then(keep) { log.push(`then ${value}`); keep(value); } });
const steps = {
  count: 0,
  [Symbol.iterator]() { return this; },
  next() { return { value: later(++this.count), done: this.count > 2 }; },
  return(sent) { return { value: later(`left ${sent}`), done: true }; },
  throw(sent) { return { value: later(`caught ${sent}`), done: false }; },
};
async function* relay() { yield* steps; }
const stream = relay();
console.log(JSON.stringify(await stream.next()), JSON.stringify(await stream.throw("a")), JSON.stringify(await stream.return("b")));
const answers = { then(keep) { keep("never asked"); }, value: 5, done: false, asked: 0 };
const odd = { [Symbol.iterator]() { return this; }, next() { answers.done = answers.asked++ > 0; return answers; } };
for await (const item of odd) log.push(`item ${item}`);
console.log(log.join(" | "));
