// Forms of await
const settled = Promise.resolve(1);

async function emptyLoop(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += turn & 1;
  return total;
}

async function awaitNumber(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await 1;
  return total;
}

async function awaitSettled(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await settled;
  return total;
}

async function double(x: number): Promise<number> {
  return x * 2;
}

async function awaitAsyncCall(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await double(turn);
  return total;
}

async function doubleLater(x: number): Promise<number> {
  await gate.wait();
  return x * 2;
}

class Gate {
  private resolveWaiter: (() => void) | null = null;
  wait(): Promise<void> {
    return new Promise<void>(resolve => {
      this.resolveWaiter = resolve;
    });
  }
  open(): boolean {
    const resolve = this.resolveWaiter;
    if (resolve === null) return false;
    this.resolveWaiter = null;
    resolve();
    return true;
  }
}
const gate = new Gate();

async function waitAtGate(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    await gate.wait();
    total++;
  }
  return total;
}

function drive(turns: number, waiter: Promise<number>): Promise<number> {
  return new Promise<number>(resolve => {
    let left = turns;
    const step = () => {
      if (gate.open() && --left > 0) setImmediate(step);
      else resolve(waiter);
    };
    setImmediate(step);
  });
}

function driveAlone(turns: number): Promise<number> {
  return new Promise<number>(resolve => {
    let left = turns;
    const step = () => {
      if (--left > 0) setImmediate(step);
      else resolve(turns);
    };
    setImmediate(step);
  });
}

async function awaitSuspendedAsyncCall(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await doubleLater(turn);
  return total;
}

class Thenable {
  constructor(private readonly value: number) {}
  then(onFulfilled: (value: number) => void): void {
    onFulfilled(this.value);
  }
}

async function awaitThenable(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await new Thenable(turn);
  return total;
}

class LazyPromise extends Promise<number> {
  then<A, B>(onFulfilled?: ((value: number) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return super.then(onFulfilled, onRejected);
  }
}

async function awaitPromiseSubclass(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await new LazyPromise(resolve => resolve(turn));
  return total;
}

async function awaitNewPromise(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await new Promise<number>(resolve => resolve(turn));
  return total;
}

async function awaitThenResult(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += await settled.then(value => value + turn);
  return total;
}

async function awaitAllOfFour(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += (await Promise.all([double(turn), double(1), double(2), double(3)])).length;
  return total;
}

async function awaitNativeSleep(turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    await Bun.sleep(0);
    total++;
  }
  return total;
}

const cases: Record<string, (turns: number) => Promise<number>> = {
  "0 empty loop": emptyLoop,
  "0 setImmediate alone": driveAlone,
  "1 a number": awaitNumber,
  "1 a fulfilled promise": awaitSettled,
  "1 a new promise, resolved in its executor": awaitNewPromise,
  "2 an async function that returns at once": awaitAsyncCall,
  "2 an async function that suspends": turns => drive(turns, awaitSuspendedAsyncCall(turns)),
  "3 a pending promise, resolved from setImmediate": turns => drive(turns, waitAtGate(turns)),
  "3 the result of then": awaitThenResult,
  "3 Bun.sleep(0)": awaitNativeSleep,
  "4 a thenable": awaitThenable,
  "4 a promise subclass with its own then": awaitPromiseSubclass,
  "5 Promise.all of four async calls": awaitAllOfFour,
};

const name = process.argv[2]!;
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  let last = 0;
  for (const turns of process.argv.slice(3)) {
    last = await cases[name]!(Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
