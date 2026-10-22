// Species: programs  method replaced through proto above what a host function hands back. It prints what plain Bun prints.
const log: string[] = [];
class Meter { measure(): string { return "first"; } }
const back: any = Bun.peek(new Meter() as any);
back.__proto__.measure = function (): string { return "replaced"; };
log.push(new Meter().measure());
console.log(log.join("; "));
