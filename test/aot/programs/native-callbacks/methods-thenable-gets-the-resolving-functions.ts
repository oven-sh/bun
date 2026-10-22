// Methods found through instances: await, Promise.resolve, a resolve function and a returned value all call `then` with two functions that native code made, while the program's own calls pass a handler object and a number.
export {};

let total = 0;

class Handler {
  done(value: number): void {
    total += value;
  }
}

class Later {
  constructor(public value: number) {}
  then(handler: Handler, priority: number): void {
    total += handler instanceof Handler ? 1 : typeof handler === "function" ? 100 : 10000;
    total += typeof priority === "number" ? 100000 : typeof priority === "function" ? 1000000 : 0;
    if (handler instanceof Handler) handler.done(this.value);
    else (handler as any)(this.value);
  }
}

new Later(3).then(new Handler(), 1);
const later = (value: number): any => new Later(value);
const values: number[] = [
  await later(1),
  await Promise.resolve(later(2)),
  await new Promise<number>(resolve => resolve(later(3))),
  await (async () => later(4))(),
  await Promise.resolve(0).then(() => later(5)),
  ...(await Promise.all([later(6), later(7)])),
  await Promise.race([later(8)]),
];
console.log(total, values.join());
