// Under: --aot-testing=CheckProofsAtRunTime: what a step of the wrapped iterator answers is held against what its row says
const First = Promise;
const log = [];
class Counted extends First {
  static get [Symbol.species]() { log.push("species"); return Counted; }
  constructor(executor) { super(executor); log.push("made"); }
}
globalThis.Promise = Counted;
function* numbers() { yield 1; yield Counted.resolve(2); }
async function* relay() { yield* numbers(); }
const stream = relay();
const step = stream.next();
console.log(step instanceof Counted, step instanceof First, Object.getPrototypeOf(step) === First.prototype, step.constructor === First);
console.log(JSON.stringify(await step), JSON.stringify(await stream.next()), JSON.stringify(await stream.next()));
const seen = [];
for await (const number of numbers()) seen.push(number);
console.log(seen.join(), log.filter(word => word === "made").length > 0);
globalThis.Promise = First;
