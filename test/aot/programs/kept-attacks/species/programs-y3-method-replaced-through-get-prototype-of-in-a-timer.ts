// Species: programs  method replaced through get prototype of in a timer. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
setTimeout((back: any) => {
  Object.getPrototypeOf(back).measure = function (): string { return "replaced"; };
  log.push(new Meter().measure());
  console.log(log.join("; "));
}, 1, new Meter());
