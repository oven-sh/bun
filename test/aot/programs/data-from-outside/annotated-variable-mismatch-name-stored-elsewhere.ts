// The variable is only read; an unrelated object literal elsewhere in the program has a property of the same name.
function compose(app: any): string {
  const meta: { secrets?: string; sign: string[] | true } = app.config.cookie;
  if (meta?.sign) return "signed";
  return "plain";
}
const unrelated = { sign: 1 };
console.log(compose({ config: { cookie: { path: "/" } } }), unrelated.sign);
