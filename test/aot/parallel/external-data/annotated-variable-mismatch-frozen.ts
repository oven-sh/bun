// The object that does not match is frozen: entering the variable does nothing to it, and a store throws what plain JavaScript throws.
interface Meta { sign: string[] | true; secrets?: string }
function compose(app: any): string {
  const meta: Meta = app.cookie;
  if (meta.sign) return "signed";
  try { meta.sign = true; } catch (e) { return (e as Error).name + " " + Object.isFrozen(meta) + " " + JSON.stringify(meta); }
  return "stored";
}
console.log(compose({ cookie: Object.freeze({ path: "/" }) }));
console.log(compose({ cookie: Object.freeze(JSON.parse('{"path":"/"}')) }));
console.log(compose({ cookie: Object.freeze({ sign: ["a"] }) }));
