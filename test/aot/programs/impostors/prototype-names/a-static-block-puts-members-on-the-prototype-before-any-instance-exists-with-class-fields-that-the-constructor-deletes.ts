// A static block of the class puts members on its own prototype, under keys it gets from a function, before any instance exists.
// The fields of those names are only declared: every instance starts with empty slots and must inherit from the first read on.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
function nameOf(index: number): string {
  return JSON.parse('["limit","label","watch"]')[index];
}
class Settings {
  declare id: number;
  limit?: number;
  label?: string;
  watch?: boolean;
  static {
    (this.prototype as any)[nameOf(0)] = 100;
    Object.defineProperty(this.prototype, nameOf(1), {
      get(this: Settings) {
        return "settings " + this.id;
      },
      configurable: true,
    });
    Object.defineProperty(this.prototype, nameOf(2), {
      set(this: Settings, value: boolean) {
        log.push(`watch ${value} on ${this.id}`);
      },
      configurable: true,
    });
  }
  constructor(id: number) {
    delete this.limit;
    delete this.label;
    delete this.watch;
    handOver(this);
    this.id = id;
  }
}
function look(settings: Settings) {
  return `${settings.limit} ${settings.label} ${settings.watch} [${Object.keys(settings)}]`;
}
function setLimit(settings: Settings, value: number) {
  settings.limit = value;
}
function setWatch(settings: Settings, value: boolean) {
  settings.watch = value;
}
function setLabel(settings: Settings, value: string) {
  try {
    settings.label = value;
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const first = new Settings(1);
console.log("the first instance:", look(first));
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const settings = new Settings(i);
  sum += settings.limit! + settings.label!.length;
  if (i % 1000 === 0) setWatch(settings, true);
  if (i & 1) setLimit(settings, 1);
  sum += settings.limit!;
}
console.log("many", sum, log.join(", "));
setLimit(first, 5);
setWatch(first, false);
console.log("stored:", look(first), setLabel(first, "x"), look(first), log[log.length - 1]);
delete (Settings.prototype as any).limit;
delete (Settings.prototype as any).label;
delete (Settings.prototype as any).watch;
const late = new Settings(2);
console.log("all three deleted:", look(first), "|", look(late));
setWatch(late, true);
console.log("stored:", setLabel(late, "own"), look(late), log.length);
