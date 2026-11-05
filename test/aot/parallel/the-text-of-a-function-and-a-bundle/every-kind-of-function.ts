// Methods, accessors, fields, arrow functions, asynchronous functions and generators: the text of each lacks what a bundle lacks. The layout is the source's own, so the text is printed without its white space.
// Reference: bun build --compile
function dead(): number {
  return 1;
}
class Holder {
  method(o: any): unknown {
    if (false) dead();
    return true ? o.a : dead();
  }
  get read(): unknown {
    return false || "read";
  }
  static fixed(o: any): unknown {
    return null ?? o.a;
  }
  field = (o: any): unknown => true ? o.a : dead();
}
const literal = {
  method(o: any): unknown {
    return true && o.a;
  },
};
const arrow = (o: any): unknown => true ? o.a : dead();
async function waits(o: any): Promise<unknown> {
  if (false) await dead();
  return true ? await o.a : dead();
}
function* yields(o: any): Generator<unknown> {
  if (false) yield dead();
  yield true ? o.a : dead();
}
const read = Object.getOwnPropertyDescriptor(Holder.prototype, "read")!.get!;
for (const shown of [Holder.prototype.method, read, Holder.fixed, new Holder().field, literal.method, arrow, waits, yields]) {
  console.log(shown.toString().replace(/\s+/g, ""));
}
