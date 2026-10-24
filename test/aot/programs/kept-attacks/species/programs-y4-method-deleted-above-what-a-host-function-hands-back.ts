// Species: programs  method deleted above what a host function hands back. It prints what plain Bun prints.
const log: string[] = [];
class Base { measure(): string { return "base"; } }
class Meter extends Base { measure(): string { return "first"; } }
const back: any = Bun.peek(new Meter() as any);
delete Object.getPrototypeOf(back).measure;
log.push(new Meter().measure());
console.log(log.join("; "));
