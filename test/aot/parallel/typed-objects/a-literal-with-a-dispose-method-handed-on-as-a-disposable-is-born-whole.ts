// `{ name, [Symbol.dispose]() { .. } }` is born with its method in a slot, also in a program that hands such objects on as `Disposable`, a type of which they are one kind among others.
// IR= 0 open (ElemSet|(Prop|Elem)Define)
// IR= 0 iterate (ElemSet|(Prop|Elem)Define)
interface Span {
  name: string;
  [Symbol.dispose](): void;
}
interface Steps {
  at: number;
  next(): { done: boolean; value: number };
  [Symbol.iterator](): Steps;
}
const log: string[] = [];
export function open(name: string): Span {
  return {
    name,
    [Symbol.dispose]() {
      log.push("closed " + this.name);
    },
  };
}
export function iterate(limit: number): Steps {
  return {
    at: 0,
    next() {
      return this.at < limit ? { done: false, value: this.at++ } : { done: true, value: -1 };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}
class Lock implements Disposable {
  held = true;
  [Symbol.dispose](): void {
    this.held = false;
    log.push("unlocked");
  }
}
function release(resource: Disposable): void {
  resource[Symbol.dispose]();
}
function total(numbers: Iterable<number>): number {
  let sum = 0;
  for (const number of numbers) sum += number;
  return sum;
}
for (let round = 0; round < 3; round++) {
  release(open("a" + round));
  release(new Lock());
  release({ [Symbol.dispose]: () => { log.push("plain"); } });
  {
    using span = open("b" + round);
    log.push("holds " + span.name);
  }
  log.push(String(total(iterate(3 + round)) + total([1, 2]) + total(new Set([round]))));
}
const span = open("keys");
log.push(Reflect.ownKeys(span).map(String).join(), Object.keys(span).join(), JSON.stringify(span), String(Symbol.dispose in span), typeof span[Symbol.dispose], span[Symbol.dispose].name);
const loose: any = span;
loose[Symbol.dispose] = function () { log.push("replaced " + this.name); };
release(span);
delete loose[Symbol.dispose];
try { release(span); } catch (error) { log.push((error as Error).name); }
console.log(log.join("\n"));
