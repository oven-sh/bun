// The other side of a class: the constructors form a chain too. A static field that is only declared is filled late on the derived constructor (`Derived.instance ??= ..`);
// then the base constructor gets a value, accessors and a read-only member of that name.
const log: string[] = [];
class Service {
  declare static instance?: Service;
  declare static uses?: number;
  constructor(public name: string) {}
}
class Mailer extends Service {}
class Logger extends Service {}
function instanceOf(target: typeof Service) {
  return (target.instance ??= new target(target.name.toLowerCase()));
}
function use(target: typeof Service) {
  target.uses = (target.uses ?? 0) + 1;
  return target.uses;
}
function state(target: typeof Service) {
  return `${target.instance?.name} ${target.uses} [${Object.keys(target)}]`;
}
function all() {
  return [Service, Mailer, Logger].map(state).join(" | ");
}
function attempt(run: () => unknown) {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

console.log("start:", all());
let sum = 0;
for (let i = 0; i < 3000; i++) {
  sum += use(Mailer) + instanceOf(Mailer).name.length;
  if (i % 1000 === 999) {
    delete Mailer.uses;
    delete Mailer.instance;
  }
}
console.log("warm", sum, all());
const base: any = Object.getPrototypeOf(Logger);
base["uses"] = 100;
base["instance"] = new Service("shared");
console.log("values on the base:", all());
console.log("used:", use(Logger), use(Logger), use(Mailer), instanceOf(Logger).name, instanceOf(Mailer).name, "|", all());
delete Logger.uses;
delete Mailer.uses;
Object.defineProperty(base, "uses", {
  get() {
    return 7;
  },
  set(this: typeof Service, value: number) {
    log.push(`${this.name}.uses = ${value}`);
  },
  configurable: true,
});
console.log("accessors on the base:", use(Logger), use(Mailer), use(Service), "|", all(), "|", log.join(", "));
Object.defineProperty(base, "uses", { value: 1, writable: false, configurable: true });
console.log("read-only on the base:", attempt(() => use(Logger)), attempt(() => use(Service)), "|", all());
delete base.uses;
delete base.instance;
console.log("gone again:", all(), "|", use(Logger), instanceOf(Logger).name, "|", all());
