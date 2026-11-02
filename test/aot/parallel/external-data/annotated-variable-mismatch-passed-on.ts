// The object that does not match goes on from the variable into typed functions, a typed property and an array.
interface Meta { sign: string[] | true; secrets?: string }
function isSigned(meta: Meta): boolean { return !!meta.sign; }
function sign(meta: Meta): void { meta.sign = true; }
class Holder { held: Meta; constructor(meta: Meta) { this.held = meta; } }
function compose(app: any): string {
  const meta: Meta = app.cookie;
  const before = isSigned(meta);
  const holder = new Holder(meta);
  const all: Meta[] = [meta];
  sign(holder.held);
  return before + " " + isSigned(all[0]!) + " " + (holder.held === app.cookie) + " " + JSON.stringify(app);
}
console.log(compose({ cookie: { path: "/" } }));
console.log(compose(JSON.parse('{"cookie":{"path":"/"}}')));
console.log(compose({ cookie: { sign: ["a"] } }));
