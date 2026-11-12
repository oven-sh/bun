// yield* asks where it opens whether its delegate is a generator of the engine whose next is the engine's; its steps go by that.
const out = [];
const log = value => out.push(String(value));
class Tree { constructor(depth) { this.depth = depth; this.kids = depth > 0 ? [new Tree(depth - 1), new Tree(depth - 2)] : []; } *walk() { yield this.depth; for (const kid of this.kids) yield* kid.walk(); return "tree " + this.depth; } }
function* plain(count) { const got = []; try { for (let i = 0; i < count; i++) got.push(yield i); } catch (error) { log("caught " + error); yield "thrown"; } finally { log("left " + got.join()); } return "end"; }
function* around(delegate) { const result = yield* delegate; log(result); return result; }
function ownNext(count) { const generator = plain(count); generator.next = function (sent) { log("own next " + sent); return Object.getPrototypeOf(plain.prototype).next.call(this, sent); }; return generator; }
function lateNext(count) { const generator = plain(count); return { [Symbol.iterator]() { const opened = generator[Symbol.iterator](); queue.push(() => { generator.next = () => { throw new Error("never"); }; }); return opened; } }; }
function otherPrototype(count) { const generator = plain(count); Object.setPrototypeOf(generator, { __proto__: Object.getPrototypeOf(plain.prototype), next(sent) { log("other next " + sent); return { value: sent, done: count-- <= 0 }; } }); return generator; }
function borrowedNext() { let calls = 0; return { [Symbol.iterator]() { return { next: Object.getPrototypeOf(plain.prototype).next, return() { calls++; return {}; } }; } }; }
const queue = [];
const delegates = [() => new Tree(3).walk(), () => plain(3), () => ownNext(2), () => lateNext(3), () => otherPrototype(2), () => borrowedNext(), () => [1, 2, 3], () => "text", () => new Map([[1, 2]]), () => around(around(plain(2))), () => { const started = plain(3); started.next(); return started; }, () => { const ended = plain(0); ended.next(); return ended; }];
function drive(step) { try { step(); } catch (error) { log(error.constructor.name); } }
for (let round = 0; round < 12; round++) {
  for (const make of delegates) {
    out.length = 0;
    queue.length = 0;
    drive(() => { for (const value of around(make())) { log(value); queue.pop()?.(); } });
    drive(() => { const generator = around(make()); for (let i = 0; i < 6; i++) { const step = generator.next("sent " + i); log(step.value + " " + step.done); } });
    drive(() => { const generator = around(make()); generator.next(); const step = generator.throw("error"); log(step.value + " " + step.done); log(generator.next().value); });
    drive(() => { const generator = around(make()); generator.next(); const step = generator.return("result"); log(step.value + " " + step.done); log(generator.next().done); });
    if (round === 11) console.log(out.join(" | "));
  }
}
