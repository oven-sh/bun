function place(address: URL, host: string, port: string): void {
  address.hostname = host;
  address.port = port;
}
(globalThis as any).placeByStrangers = place;
const placeAny = (value: unknown, host: string, port: string): string => {
  try {
    (globalThis as any).placeByStrangers(value, host, port);
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
};

const shadowed = new URL("https://shadowed.example:1/");
Object.defineProperty(shadowed, "hostname", { value: "own", writable: true, enumerable: true, configurable: true });
console.log(placeAny(shadowed, "a.example", "2"), shadowed.href, shadowed.hostname, Object.getOwnPropertyNames(shadowed).join());

const ownReadOnly = new URL("https://read-only.example:1/");
Object.defineProperty(ownReadOnly, "port", { value: "own", writable: false });
console.log(placeAny(ownReadOnly, "b.example", "3"), ownReadOnly.href, ownReadOnly.port);

const heard: string[] = [];
const ownSetter = new URL("https://own-setter.example:1/");
Object.defineProperty(ownSetter, "hostname", { set(value: string) { heard.push(value); }, get() { return "own getter"; } });
console.log(placeAny(ownSetter, "c.example", "4"), ownSetter.href, ownSetter.hostname, heard.join());

const moved = new URL("https://moved.example:1/");
Object.setPrototypeOf(moved, { set hostname(value: string) { heard.push("moved " + value); } });
console.log(placeAny(moved, "d.example", "5"), heard.join(), Object.getOwnPropertyNames(moved).join(), URL.prototype.toString.call(moved));

const orphan = new URL("https://orphan.example:1/");
Object.setPrototypeOf(orphan, null);
console.log(placeAny(orphan, "e.example", "6"), Object.getOwnPropertyNames(orphan).sort().join(), URL.prototype.toString.call(orphan));

const frozen = Object.freeze(new URL("https://frozen.example:1/"));
console.log(placeAny(frozen, "f.example", "7"), frozen.href);

const sealed = Object.seal(new URL("https://sealed.example:1/"));
console.log(placeAny(sealed, "g.example", "8"), sealed.href);

const extra = new URL("https://extra.example:1/");
(extra as any).note = "an own name that is none of the two";
console.log(placeAny(extra, "h.example", "9"), extra.href, (extra as any).note);

class Address extends URL {
  override set hostname(value: string) { heard.push("subclass " + value); super.hostname = value.toUpperCase(); }
  override get hostname() { return super.hostname; }
}
const derived = new Address("https://derived.example:1/");
console.log(placeAny(derived, "i.example", "10"), derived.href, heard.join());

class Same extends URL {}
const same = new Same("https://same.example:1/");
console.log(placeAny(same, "j.example", "11"), same.href);

const real = new URL("https://real.example:1/");
console.log(placeAny(real, "k.example", "12"), real.href);
