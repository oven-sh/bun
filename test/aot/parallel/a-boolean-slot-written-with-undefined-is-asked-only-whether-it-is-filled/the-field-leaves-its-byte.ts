// The same reads of objects whose field is no more in its byte: deleted, redefined, stored with a value of another type, answered from above: all by hands that the build cannot follow; and of strangers.
class Server {
  joins: boolean | undefined;
  strict: boolean;
  quiet: boolean | null;
  loud: boolean;
  constructor(joins?: boolean, quiet?: boolean) {
    this.joins = joins;
    this.strict = joins === true;
    this.quiet = quiet ?? null;
    this.loud = !quiet;
  }
}
function read(first: Server | undefined, second: Server): string { const server = first ?? second; return (server.joins ? "truthy" : "falsy") + " " + String(server.joins) + " " + (server.quiet ? "truthy" : "falsy") + " " + String(server.quiet); }
(globalThis as any).readByStrangers = read;
(globalThis as any).handBack = (value: unknown) => value;
const unseen = (value: unknown): any => (globalThis as any).handBack(value);
const names: string[] = unseen(["joins", "quiet"]);
const readAny = (value: unknown): string => {
  try {
    return (globalThis as any).readByStrangers(value, value);
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
};
const heard: string[] = [];
const made = (first: unknown, second: unknown): any => {
  const object = unseen({});
  object[names[0]] = first;
  object[names[1]] = second;
  return object;
};
const deleted = new Server(true, true);
delete unseen(deleted)[names[0]];
console.log(readAny(deleted), Object.keys(deleted).join());
unseen(Server).prototype[names[0]] = "from above";
console.log(readAny(deleted), readAny(new Server()), readAny(new Server(false)));
delete unseen(Server).prototype[names[0]];
const withGetter = new Server(false, false);
unseen(Object).defineProperty(unseen(withGetter), names[1], { get() { heard.push("quiet"); return "by the getter"; }, configurable: true });
console.log(readAny(withGetter), heard.join());
const otherTypes = new Server();
for (const value of ["text", "", 0, 1, NaN, {}, [], 10n, Symbol.iterator, () => 1, null, undefined, true, false]) {
  unseen(otherTypes)[names[0]] = value;
  unseen(otherTypes)[names[1]] = value;
  console.log(readAny(otherTypes));
}
const hidden = new Server(true);
unseen(Object).defineProperty(unseen(hidden), names[0], { enumerable: false });
console.log(readAny(hidden), Object.keys(hidden).join());
const readOnly = new Server(undefined, true);
unseen(Object).defineProperty(unseen(readOnly), names[0], { writable: false });
console.log(readAny(readOnly), readAny(unseen(Object).freeze(new Server())), readAny(unseen(Object).seal(new Server(false, true))));
const relinked = new Server();
unseen(Object).setPrototypeOf(unseen(relinked), made("never seen: the own field answers", "nor this"));
console.log(readAny(relinked));
const emptied = new Server(true, true);
for (const name of names) delete unseen(emptied)[name];
const above = made(0, "above");
unseen(Object).defineProperty(above, names[0], { get() { heard.push("above"); return 0; } });
unseen(Object).setPrototypeOf(unseen(emptied), above);
console.log(readAny(emptied), heard.join());
for (const stranger of [{}, made(1, "x"), Object.create(new Server(true, true)), new Proxy(new Server(true), {}), [], "text", 5, null, undefined]) console.log(readAny(stranger));
console.log(readAny(new Server()), readAny(new Server(true, false)));
