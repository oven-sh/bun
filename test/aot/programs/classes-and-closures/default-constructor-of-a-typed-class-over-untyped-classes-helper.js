export const seen = [];
class Yieldable extends globalThis.Error {}
export class Base extends Yieldable {
  constructor(args, ...more) {
    super(args?.message, args?.cause ? { cause: args.cause } : undefined);
    seen.push(new.target.name + "/" + more.length);
    if (args?.fail) throw new RangeError("failed in Base");
    if (args) Object.assign(this, args);
  }
}
export const tagged = (tag) => {
  class Tagged extends Base {
    _tag = tag;
    static made = 0;
  }
  Tagged.prototype.name = tag;
  return Tagged;
};
export class Plain {
  constructor(a, b) {
    this.sum = a + b;
    this.target = new.target.name;
  }
}
export class OverPlain extends Plain {}
