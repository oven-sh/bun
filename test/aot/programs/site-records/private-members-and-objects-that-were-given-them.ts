// A private member belongs to the objects that ran the class's initializers, whatever their layout: instances, subclass instances, and any object that a base constructor handed back. Everything else throws a TypeError, a Proxy around an instance too.
class Vault {
  #secret = "secret";
  #count = 0;
  open = "open";
  #bump(): number {
    return ++this.#count;
  }
  get #view(): string {
    return this.#secret + "/" + this.#count;
  }
  static secretOf(value: Vault): string {
    return value.#secret;
  }
  static setSecret(value: Vault, to: string): void {
    value.#secret = to;
  }
  static bump(value: Vault): number {
    return value.#bump();
  }
  static viewOf(value: Vault): string {
    return value.#view;
  }
  static has(value: unknown): boolean {
    return typeof value === "object" && value !== null && #secret in value;
  }
}
class DeepVault extends Vault {
  more = "more";
  #secret = "another secret of the same name";
  static deepSecretOf(value: DeepVault): string {
    return value.#secret;
  }
}

class HandsBack {
  constructor(value: object) {
    return value;
  }
}
class Stamp extends HandsBack {
  #mark = "stamped";
  #times = 1;
  static markOf(value: unknown): string {
    return (value as Stamp).#mark + " " + (value as Stamp).#times;
  }
  static again(value: unknown): number {
    return ++(value as Stamp).#times;
  }
  static has(value: object): boolean {
    return #mark in value;
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function look(mark: string, value: unknown): void {
  const vault = value as Vault;
  console.log(mark + ":", attempt(() => Vault.secretOf(vault)), attempt(() => Vault.setSecret(vault, "changed")), attempt(() => Vault.secretOf(vault)), attempt(() => Vault.bump(vault)), attempt(() => Vault.viewOf(vault)), attempt(() => Vault.has(vault)), attempt(() => DeepVault.deepSecretOf(vault as DeepVault)));
}
function lookAtStamp(mark: string, value: object): void {
  console.log(mark + ":", attempt(() => Stamp.has(value)), attempt(() => Stamp.markOf(value)), attempt(() => new Stamp(value) === value), attempt(() => Stamp.has(value)), attempt(() => Stamp.markOf(value)), attempt(() => Stamp.again(value)), attempt(() => Stamp.markOf(value)), attempt(() => new Stamp(value)), Object.keys(value).join());
}

look("instance", new Vault());
look("subclass instance", new DeepVault());
look("instance", new Vault());
look("look-alike", { open: "open" });
look("heir of an instance", Object.create(new Vault()));
look("proxy around an instance", new Proxy(new Vault(), {}));
look("same prototype, not constructed", Object.create(Vault.prototype));
look("null", null);
look("number", 5);
look("frozen instance", Object.freeze(new Vault()));
look("instance with a deleted field", (() => {
  const vault = new Vault();
  delete (vault as any).open;
  return vault;
})());
look("instance with another prototype", Object.setPrototypeOf(new Vault(), null));
look("instance", new Vault());

lookAtStamp("literal", { a: 1 });
lookAtStamp("parsed", JSON.parse('{"b":2}'));
lookAtStamp("instance of another class", new Vault());
lookAtStamp("array", [1]);
lookAtStamp("function", function () {});
lookAtStamp("frozen", Object.freeze({ c: 3 }));
lookAtStamp("proxy", new Proxy({}, {}));
lookAtStamp("no prototype", Object.create(null));

export {};
