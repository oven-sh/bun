// Species: programs  method replaced through proto of a resolved value. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
Promise.resolve<any>(new Meter()).then(back => {
  back.__proto__.measure = function (): string { return "replaced"; };
  log.push(new Meter().measure());
  console.log(log.join("; "));
});
