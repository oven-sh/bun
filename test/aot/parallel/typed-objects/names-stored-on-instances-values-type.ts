// Names stored on instances through values of type any.
class Message {
  url = "/";
  next: Message | null = null;
  ownRoute(): unknown {
    return (this as any).route;
  }
  storeOwnRoute(value: unknown): unknown {
    (this as any).route = value;
    return (this as any).route;
  }
  storeTwice(value: unknown): string {
    const self = this as any;
    self.route = value;
    const first = self.route;
    self.route = first + "!";
    return first + " " + self.route + " " + ("route" in self) + " " + Object.hasOwn(self, "route");
  }
}
class Urgent extends Message {
  level = 1;
}
class Options {
  host = "localhost";
  port = 80;
}
class Other {
  query = "declared here";
}
const give = (message: any, value: unknown): void => {
  message.params = value;
  message.query = value;
  message.route = value;
};
const read = (message: any) => [message.params, message.query, message.route].join();
const describe = (value: any) => {
  const inTurn: string[] = [];
  for (const key in value) inTurn.push(key);
  return [Object.keys(value).join(), inTurn.join(), JSON.stringify(value), "params" in value, Object.hasOwn(value, "route"), Object.getOwnPropertyNames(value).length].join(" ");
};
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
for (let turn = 0; turn < 3; turn++) {
  const untouched = new Message();
  show("untouched", () => read(untouched) + " " + describe(untouched));
  const message = new Message();
  give(message, turn);
  show("given", () => read(message) + " " + describe(message));
  give(message, "again");
  show("given again", () => read(message) + " " + describe(message));
  delete (message as any).query;
  show("one deleted", () => read(message) + " " + describe(message));
  (message as any).query = "back";
  show("and back", () => read(message) + " " + describe(message));
  message.url = "/changed";
  show("a declared field stored", () => message.url + " " + describe(message));
  const urgent = new Urgent();
  give(urgent, turn);
  show("a subclass", () => read(urgent) + " " + describe(urgent) + " " + urgent.level);
  const other = new Other();
  give(other, "t" + turn);
  show("another class, which declares one of the names", () => read(other) + " " + describe(other));
  const plain = JSON.parse('{"url":"/plain"}');
  give(plain, turn);
  show("a plain object", () => read(plain) + " " + describe(plain));
  for (const value of [undefined, null, 1.5, "s", true, 10n, Symbol.iterator, [1], { a: 1 }, () => 1, new Message()]) {
    const holder = new Message();
    give(holder, value);
    show("holds " + typeof value, () => (holder as any).params === value && (holder as any).route === value && Object.keys(holder).join());
  }
  const options = new Options();
  (options as any).tag = turn;
  show("through a cast", () => (options as any).tag + " " + describe(options) + " " + JSON.stringify({ ...options }) + " " + JSON.stringify(Object.assign({}, options)));
  (options as any).tag += 1;
  (options as any).tag++;
  show("counted up", () => (options as any).tag);
  const inOtherOrder = new Message();
  (inOtherOrder as any).route = 1;
  (inOtherOrder as any).params = 2;
  show("in another order", () => describe(inOtherOrder));
  const frozen = Object.freeze(new Message());
  show("frozen", () => give(frozen, 1));
  show("frozen after", () => describe(frozen));
  const sealed = Object.seal(new Message());
  show("sealed", () => give(sealed, 1));
  const closed = Object.preventExtensions(new Message());
  show("not extensible", () => give(closed, 1));
  const partly = new Message();
  (partly as any).params = 1;
  Object.preventExtensions(partly);
  show("closed after one", () => give(partly, 2));
  show("closed after one, after", () => describe(partly));
  const defined = new Message();
  Object.defineProperty(defined, "params", { value: "fixed", writable: false, enumerable: false, configurable: true });
  show("defined and not writable", () => give(defined, 1));
  show("defined and not writable, after", () => read(defined) + " " + describe(defined));
  const accessed = new Message();
  let seen = 0;
  Object.defineProperty(accessed, "query", { set: (value: number) => { seen += value; }, get: () => "got", enumerable: true, configurable: true });
  show("an accessor of its own", () => { give(accessed, 5); return read(accessed) + " " + seen + " " + describe(accessed); });
  const inheriting = Object.create(message);
  show("inherits", () => read(inheriting) + " " + describe(inheriting));
  give(inheriting, "own");
  show("inherits, then has its own", () => read(inheriting) + " " + read(message) + " " + Object.keys(inheriting).join());
  const [first, second]: string[] = JSON.parse('["k1","k2"]');
  const descriptorOf = (value: object, name: string) => JSON.stringify(Object.getOwnPropertyDescriptor(value, name), (_, part) => (typeof part === "function" ? "function" : part));
  const between: any = new Message();
  between[first] = 1;
  give(between, "stored");
  between[second] = 2;
  show("before it moves", () => describe(between) + " " + descriptorOf(between, "query"));
  let stores = 0;
  Object.defineProperty(between, "query", { get: () => "computed", set: () => { stores++; }, enumerable: true, configurable: true });
  show("an accessor in the place of a stored value", () => read(between) + " " + describe(between) + " " + descriptorOf(between, "query"));
  give(between, "stored again");
  show("stores reach the setter", () => read(between) + " " + stores + " " + describe(between));
  show("copies", () => JSON.stringify({ ...between }) + " " + JSON.stringify(Object.assign({}, between)) + " " + JSON.stringify(Object.entries(between)));
  delete between.query;
  show("the accessor deleted", () => read(between) + " " + describe(between) + " " + descriptorOf(between, "query"));
  give(between, "a third time");
  show("and stored anew", () => read(between) + " " + describe(between) + " " + descriptorOf(between, "query"));
  const onlyRead: any = new Message();
  give(onlyRead, 1);
  Object.defineProperty(onlyRead, "params", { get: () => "no setter" });
  show("a getter alone", () => give(onlyRead, 2));
  show("a getter alone, after", () => read(onlyRead) + " " + describe(onlyRead) + " " + descriptorOf(onlyRead, "params"));
  const fixed: any = new Message();
  give(fixed, 1);
  Object.defineProperty(fixed, "route", { configurable: false });
  Object.defineProperty(fixed, "params", { enumerable: false });
  Object.defineProperty(fixed, "query", { writable: false });
  show("other attributes", () => describe(fixed) + " " + descriptorOf(fixed, "route") + descriptorOf(fixed, "params") + descriptorOf(fixed, "query"));
  show("a fixed one deleted", () => delete fixed.route);
  show("a fixed one made an accessor", () => Object.defineProperty(fixed, "route", { get: () => 1 }));
  show("one that may not be written", () => give(fixed, 2));
  show("other attributes, after", () => read(fixed) + " " + describe(fixed));
  const several: any = new Urgent();
  give(several, 1);
  Object.defineProperties(several, { params: { get: () => "p", enumerable: true, configurable: true }, route: { value: "r", writable: true, enumerable: true, configurable: true } });
  show("several at once, in a subclass", () => read(several) + " " + describe(several) + " " + several.level);
  show("by Reflect", () => Reflect.defineProperty(several, "query", { get: () => "q", configurable: true }) + " " + read(several) + " " + describe(several));
  const old: any = new Message();
  old.__defineGetter__("route", () => "old style");
  show("__defineGetter__", () => read(old) + " " + describe(old));
  const cold: any = new Message();
  give(cold, 1);
  Object.defineProperty(cold, "query", { get: () => "frozen later", enumerable: true, configurable: true });
  Object.freeze(cold);
  show("frozen after it moved", () => Object.isFrozen(cold) + " " + read(cold) + " " + describe(cold) + " " + descriptorOf(cold, "query") + descriptorOf(cold, "params"));
  show("frozen after it moved, stored", () => give(cold, 2));
  const mixed: any[] = [message, between, new Message(), onlyRead, several, plain, old];
  let all = "";
  for (let round = 0; round < 3; round++) for (let i = 0; i < mixed.length; i++) all += read(mixed[i]) + ";";
  show("all kinds in one loop", () => all);
  const withOther: any = new Message();
  withOther[first] = 1;
  give(withOther, "beside another");
  show("created beside another extra property", () => read(withOther) + " " + describe(withOther));
  const routeName: string = JSON.parse('"route"');
  const readRoute = (value: any) => value.route;
  const storeRoute = (value: any, stored: unknown) => { value.route = stored; };
  const hasRoute = (value: any) => "route" in value;
  const ownsRoute = (value: any) => Object.hasOwn(value, "route");
  const readKeyed = (value: any) => value[routeName];
  const storeKeyed = (value: any, stored: unknown) => { value[routeName] = stored; };
  const hasKeyed = (value: any) => routeName in value;
  const ownsKeyed = (value: any) => Object.hasOwn(value, routeName);
  const besideAnother = () => {
    const made: any = new Message();
    made[first] = 1;
    return made;
  };
  const ask = (value: any) => [readRoute(value), readKeyed(value), hasRoute(value), hasKeyed(value), ownsRoute(value), ownsKeyed(value), Object.keys(value).join()].join(" ");
  let warmed = "";
  for (let round = 0; round < 6; round++) {
    const without = besideAnother();
    warmed += ask(without) + ";";
    const byName = besideAnother();
    storeRoute(byName, round);
    warmed += ask(byName) + ";";
    storeRoute(byName, round + 1);
    const byKey = besideAnother();
    storeKeyed(byKey, round);
    warmed += ask(byKey) + ask(byName) + ";";
  }
  show("the caches are warm", () => warmed);
  let setterCalls = 0;
  const movedOut = besideAnother();
  Object.defineProperty(movedOut, "route", { get: () => "moved out", set: () => { setterCalls++; }, enumerable: true, configurable: true });
  show("after them one whose name moved out", () => ask(movedOut));
  storeRoute(movedOut, 1);
  storeKeyed(movedOut, 2);
  show("stores of both kinds reach its setter", () => setterCalls + " " + ask(movedOut));
  show("and one as before", () => ask(besideAnother()));
  const movedOutLater = besideAnother();
  storeRoute(movedOutLater, "stored first");
  Object.defineProperty(movedOutLater, "route", { get: () => "moved out later", set: () => { setterCalls++; }, enumerable: true, configurable: true });
  storeRoute(movedOutLater, 3);
  storeKeyed(movedOutLater, 4);
  show("one that held a value", () => setterCalls + " " + ask(movedOutLater));
  show("deleted", () => delete movedOut.route + " " + ask(movedOut));
  storeRoute(movedOut, "a value again");
  show("stored after that", () => setterCalls + " " + ask(movedOut) + " " + descriptorOf(movedOut, "route"));
  const throughThis = new Message();
  show("through this, absent", () => throughThis.ownRoute());
  show("through this", () => throughThis.storeOwnRoute("own") + " " + throughThis.ownRoute() + " " + throughThis.storeTwice("twice") + " " + describe(throughThis));
  const throughThisBeside: Message = besideAnother();
  show("through this, beside another", () => throughThisBeside.ownRoute() + " " + throughThisBeside.storeOwnRoute("own") + " " + throughThisBeside.storeTwice("twice") + " " + describe(throughThisBeside));
  let handed = "";
  const answersItself = new Message();
  Object.defineProperty(answersItself, "route", { get: () => "the getter", set: (value: unknown) => { handed += value + ";"; }, enumerable: true, configurable: true });
  show("through this, moved out", () => answersItself.ownRoute() + " " + answersItself.storeOwnRoute("own") + " " + answersItself.storeTwice("twice") + " " + handed + " " + describe(answersItself));
  const answersLater = new Message();
  answersLater.storeOwnRoute("first a value");
  Object.defineProperty(answersLater, "route", { get: () => "the getter", set: (value: unknown) => { handed += value + ";"; }, enumerable: true, configurable: true });
  show("through this, moved out later", () => answersLater.ownRoute() + " " + answersLater.storeOwnRoute("own") + " " + answersLater.storeTwice("twice") + " " + handed + " " + describe(answersLater));
  const urgentItself = new Urgent();
  show("through this, in a subclass", () => urgentItself.storeOwnRoute("own") + " " + urgentItself.storeTwice("twice") + " " + describe(urgentItself));
  show("null", () => give(null, 1));
  show("a number", () => give(1, 1));
  if (turn === 1 && typeof Bun !== "undefined") Bun.gc(true);
  show("after all", () => read(message) + " " + describe(message));
}
