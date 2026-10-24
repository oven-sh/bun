// A prototype that has the layout of its instances with every slot empty (`Address.prototype = {} as Address`), and one that keeps a default its slot cannot hold.
// Each round stores and reads by name often enough to fill the caches. Between the rounds the prototypes change in every way that decides what a store or a read below them finds.
function attempt(run: () => unknown) { try { return String(run()); } catch (e) { return (e as Error).name; } }

interface Address { protocol: any; host: any; port: any; path: any; describe(): string }
function Address(this: Address) {
  this.protocol = null;
  this.host = null;
  this.port = null;
}
Address.prototype = {} as Address;
Address.prototype.describe = function describe(this: Address) { return this.protocol + "//" + this.host + ":" + this.port + this.path; };

interface Emitter { listeners?: object; count: number; limit?: number }
function Emitter(this: Emitter) {
  if (this.listeners === undefined) this.listeners = {};
  this.limit ??= undefined;
  this.count = this.count + 1;
}
const emitterPrototype = Emitter.prototype as Emitter;
emitterPrototype.listeners = undefined;
emitterPrototype.count = 0;
emitterPrototype.limit = undefined;
function Stream(this: Emitter) { (Emitter as any).call(this); }
Object.setPrototypeOf(Stream.prototype, Emitter.prototype);

// What a proxy has seen is out of the compiler's sight, so these objects are read and stored by name.
const outOfSight: any = new Proxy({}, {});
outOfSight.value = Address;
outOfSight.value = Emitter;
outOfSight.value = Stream;

const log: string[] = [];
function round(label: string) {
  let last = "";
  for (let i = 0; i < 24; i++) {
    last = attempt(() => {
      const address = new (Address as any)();
      address.path = "/" + (i & 1);
      const stream = new (Stream as any)();
      return address.describe() + " own:" + Object.keys(address) + " | " + typeof stream.listeners + "," + stream.count + "," + stream.limit + " own:" + Object.keys(stream);
    });
  }
  console.log(label + ": " + last + (log.length ? " log:" + log.splice(0).slice(-3) : ""));
}

round("start");
Address.prototype.path = "/inherited";
round("compiled code fills a slot of the prototype");
Address.prototype.host = "inherited";
round("and another one, which the constructor shadows");
delete (Address.prototype as any).path;
delete (Address.prototype as any).host;
round("both deleted");
Object.defineProperty(Address.prototype, "port", { configurable: true, get() { return 80; }, set(value) { log.push("port=" + value); } });
round("an accessor on the prototype");
Object.defineProperty(Address.prototype, "port", { configurable: true, get() { return 81; } });
round("a getter alone");
delete (Address.prototype as any).port;
round("accessor deleted");
Object.defineProperty(Address.prototype, "protocol", { configurable: true, writable: false, value: "fixed:" });
round("a read-only property on the prototype");
delete (Address.prototype as any).protocol;
round("read-only property deleted");
const above = { set host(value: unknown) { log.push("host=" + value); }, get host() { return "above"; } };
Object.setPrototypeOf(Address.prototype, above);
round("a setter above the empty slot");
Address.prototype.host = "hides the setter";
round("compiled code fills the slot below the setter");
delete (Address.prototype as any).host;
round("slot emptied again");
Object.setPrototypeOf(Address.prototype, new Proxy({}, { set(target, key, value, receiver) { log.push("trap " + String(key)); return Reflect.set(target, key, value, receiver); } }));
round("a proxy above the prototype");
Object.setPrototypeOf(Address.prototype, Object.prototype);
round("chain restored");
emitterPrototype.count = 10;
round("another default");
emitterPrototype.listeners = { shared: true };
round("a default its slot can hold");
Object.defineProperty(emitterPrototype, "limit", { configurable: true, set(value) { log.push("limit=" + value); } });
round("a setter in place of a default");
Object.freeze(emitterPrototype);
round("frozen prototype");
Object.freeze(Address.prototype);
round("both frozen");
