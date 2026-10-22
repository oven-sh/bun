// `await` in an async generator and at the top level of a module: for each kind of awaited value, jobs run in the same order in code that runs once and in a loop of 10,000.
let log: string[] = [];
let currentStep = 0;
const say = (text: string): void => {
  log.push(text);
};
const show = (value: unknown): void => say("= " + String(value));

// Logs the next `turns` turns of the job queue, until the next step begins, so the log shows in which turn each await resumed.
function begin(name: string, turns: number): void {
  say(name);
  const step = ++currentStep;
  let turn = 0;
  const next = (): void => {
    if (step !== currentStep) return;
    say("turn " + ++turn);
    if (turn < turns) queueMicrotask(next);
  };
  if (turns) queueMicrotask(next);
}
function take(): string {
  const round = log.join(", ");
  log = [];
  return round;
}
function count(rounds: Map<string, number>): void {
  const round = take();
  rounds.set(round, (rounds.get(round) ?? 0) + 1);
}

class Derived<T> extends Promise<T> {
  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    say("Derived.then");
    return super.then(onFulfilled, onRejected);
  }
}
const one = (): number => 1;
const two = (): string => "two";
const fulfilled = (): Promise<number> => Promise.resolve(3);
const rejected = (): Promise<number> => Promise.reject(new RangeError("four"));
const pending = (): Promise<number> =>
  new Promise<number>(resolve => {
    queueMicrotask(() =>
      queueMicrotask(() => {
        say("resolve");
        resolve(5);
      }),
    );
  });
function withOwnThen(): Promise<number> {
  const promise = Promise.resolve(6);
  (promise as any).then = (): void => say("own then was called");
  return promise;
}
const derived = (): Derived<number> => new Derived<number>(resolve => resolve(7));
const thenable = () => ({
  then(resolve: (value: number) => void): void {
    say("thenable.then");
    resolve(8);
  },
});
const plain = () => ({ value: 9 });
const untyped: unknown[] = [10, "eleven", Promise.resolve(12), null];

async function* awaitOnce(turns: number): AsyncGenerator<void> {
  begin("primitives", turns); show(await one()); show(await two());
  begin("fulfilled", turns); show(await fulfilled());
  begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
  begin("pending", turns); show(await pending());
  begin("own then", turns); show(await withOwnThen());
  begin("derived", turns); show(await derived());
  begin("thenable", turns); show(await thenable());
  begin("plain object", turns); show((await plain()).value);
  begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
  begin("end", 0);
  yield;
}
async function* awaitInLoop(): AsyncGenerator<void> {
  for (let round = 0; round < 10_000; round++) {
    const turns = round & 1 ? 4 : 0;
    begin("primitives", turns); show(await one()); show(await two());
    begin("fulfilled", turns); show(await fulfilled());
    begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
    begin("pending", turns); show(await pending());
    begin("own then", turns); show(await withOwnThen());
    begin("derived", turns); show(await derived());
    begin("thenable", turns); show(await thenable());
    begin("plain object", turns); show((await plain()).value);
    begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
    begin("end", 0);
    yield;
  }
}
async function roundsOf(generator: AsyncGenerator<void>): Promise<Map<string, number>> {
  const rounds = new Map<string, number>();
  for await (const _ of generator) count(rounds);
  return rounds;
}
function report(label: string, once: string[], inLoop: Map<string, number>): void {
  for (const round of once) console.log(label + ": " + round);
  console.log(label + ", in a loop: " + once.map(round => inLoop.get(round)).join() + " of " + inLoop.size + " kinds of rounds");
}

begin("primitives", 0); show(await one()); show(await two());
begin("fulfilled", 0); show(await fulfilled());
begin("rejected", 0); try { show(await rejected()); } catch (error) { show(error); }
begin("pending", 0); show(await pending());
begin("own then", 0); show(await withOwnThen());
begin("derived", 0); show(await derived());
begin("thenable", 0); show(await thenable());
begin("plain object", 0); show((await plain()).value);
begin("untyped", 0); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
begin("end", 0);
const quietRound = take();

begin("primitives", 4); show(await one()); show(await two());
begin("fulfilled", 4); show(await fulfilled());
begin("rejected", 4); try { show(await rejected()); } catch (error) { show(error); }
begin("pending", 4); show(await pending());
begin("own then", 4); show(await withOwnThen());
begin("derived", 4); show(await derived());
begin("thenable", 4); show(await thenable());
begin("plain object", 4); show((await plain()).value);
begin("untyped", 4); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
begin("end", 0);
const busyRound = take();

const roundsAtTopLevel = new Map<string, number>();
for (let round = 0; round < 10_000; round++) {
  const turns = round & 1 ? 4 : 0;
  begin("primitives", turns); show(await one()); show(await two());
  begin("fulfilled", turns); show(await fulfilled());
  begin("rejected", turns); try { show(await rejected()); } catch (error) { show(error); }
  begin("pending", turns); show(await pending());
  begin("own then", turns); show(await withOwnThen());
  begin("derived", turns); show(await derived());
  begin("thenable", turns); show(await thenable());
  begin("plain object", turns); show((await plain()).value);
  begin("untyped", turns); show(await untyped[0]); show(await untyped[1]); show(await untyped[2]); show(await untyped[3]);
  begin("end", 0);
  count(roundsAtTopLevel);
}
report("top level", [quietRound, busyRound], roundsAtTopLevel);

const onceInGenerator = [...(await roundsOf(awaitOnce(0))).keys(), ...(await roundsOf(awaitOnce(4))).keys()];
report("async generator", onceInGenerator, await roundsOf(awaitInLoop()));

export {};
