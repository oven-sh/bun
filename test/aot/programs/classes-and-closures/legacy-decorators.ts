// Lowered TypeScript decorators call helpers that are compiled with the program, so nothing runs in the interpreter.
declare const console: { log(...values: unknown[]): void };
const log: string[] = [];
function tag(label: string) {
  return (target: any, key?: string | symbol, third?: any): void => {
    log.push(`${label}: ${typeof target} ${String(key)} ${third !== null && typeof third === "object" ? "descriptor" : String(third)}`);
  };
}
function double(_target: any, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const original = descriptor.value as (...args: number[]) => number;
  return { ...descriptor, value(this: unknown, ...args: number[]) { return 2 * original.apply(this, args); } };
}
function named(target: any): void { target.label = "named " + target.name; }
@named
@tag("class")
class Service {
  static label = "";
  @tag("field") name = "x";
  constructor(@tag("constructor parameter") public start: number) {}
  @tag("method") @double add(a: number, @tag("parameter") b: number): number { return this.start + a + b; }
  @tag("accessor") get size(): number { return 3; }
}
const service = new Service(1);
console.log(log.join("\n"));
console.log(service.add(2, 3), service.size, service.name, Service.label);
