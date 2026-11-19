function compose(steps: any[]) {
  return function (context: any, next: any) {
    let index = -1;
    return dispatch(0);
    function dispatch(i: number): any {
      if (i <= index) return Promise.reject(new Error("twice"));
      index = i;
      let fn = steps[i];
      if (i === steps.length) fn = next;
      if (!fn) return undefined;
      return fn(context, dispatch.bind(null, i + 1));
    }
  };
}
let kept = 0;
const steps = [
  (context: any, next: any) => { context.seen++; return next(); },
  (context: any, next: any) => { context.seen++; return next(); },
];
(globalThis as any).hold = steps;
const run = compose((globalThis as any).hold);
const turns = Number(process.argv[2] ?? 3) * 100;
const context = { seen: 0 };
for (let turn = 0; turn < turns; turn++) run(context, undefined);
console.log(context.seen);
