// The object that does not match has an accessor: it runs when the property is read or stored, not when the object enters the variable.
interface Meta { sign: string[] | true; count: number }
const log: string[] = [];
function make(): any {
  let held: unknown = undefined;
  return { get sign() { log.push("get"); return held; }, set sign(value: unknown) { log.push("set"); held = value; }, path: "/" };
}
function compose(app: any): string {
  const meta: Meta = app.cookie;
  log.push("entered");
  if (meta.sign) return "signed";
  meta.sign = true;
  return meta.sign ? "signed now" : "plain";
}
console.log(compose({ cookie: make() }), log.join(","));
