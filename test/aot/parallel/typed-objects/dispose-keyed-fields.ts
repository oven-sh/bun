// A member keyed by Symbol.dispose or Symbol.asyncDispose is a field of a record's layout: literals with a method or a function under that key, `using`, `await using`, classes and host objects where such a record is expected.
// IR+ ^layout L[0-9]+ .*name="Span" .* representation=Typed
// IR+ ^layout L[0-9]+ .*\{name=WellKnownSymbol "[^"]*dispose" declared=undefined.null.function
// IR= 0 open (ElemSet|(Prop|Elem)Define)
// IR= 0 closeByHand ElemGet
const log: string[] = [];
interface Span {
  name: string;
  depth: number;
  [Symbol.dispose](): void;
}
interface Connection {
  id: number;
  [Symbol.asyncDispose]: () => Promise<void>;
}
function open(name: string, depth: number): Span {
  return {
    name,
    depth,
    [Symbol.dispose]() {
      log.push("closed " + this.name + this.depth);
    },
  };
}
function connect(id: number): Connection {
  return { id, [Symbol.asyncDispose]: async () => { log.push("disconnected " + id); } };
}
function closeByHand(span: Span): string {
  span[Symbol.dispose]();
  return typeof span[Symbol.dispose] + span[Symbol.dispose].name + (Symbol.dispose in span);
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
function nested(): number {
  using outer = open("outer", 1);
  using inner = open("inner", outer.depth + 1);
  using lock = new Lock();
  log.push("body " + inner.depth + lock.held);
  return inner.depth;
}
async function connected(): Promise<number> {
  await using connection = connect(4);
  log.push("using " + connection.id);
  return connection.id;
}
(globalThis as { kept?: unknown }).kept = [open, connect, closeByHand, release];
console.log(nested(), log.splice(0).join());
console.log(closeByHand(open("hand", 0)), log.splice(0).join());
const lock = new Lock();
release(lock);
release(open("released", 3));
release({ [Symbol.dispose]: () => { log.push("plain"); } });
const stack = new DisposableStack();
stack.use(open("stacked", 9));
stack.defer(() => { log.push("deferred"); });
release(stack);
console.log(lock.held, log.splice(0).join());
const span = open("keys", 5);
console.log(Reflect.ownKeys(span).map(String).join(), Object.keys(span).join(), JSON.stringify(span), Object.getOwnPropertySymbols({ ...span })[0] === Symbol.dispose);
const loose: any = span;
loose[Symbol.dispose] = function () { log.push("replaced " + this.name); };
{
  using _ = span;
}
console.log(log.splice(0).join());
connected().then(id => console.log(id, log.splice(0).join()));
