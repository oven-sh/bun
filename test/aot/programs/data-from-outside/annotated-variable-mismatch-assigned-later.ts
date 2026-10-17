// The annotated variable is declared without a value and assigned from `any` later.
interface Meta { sign: string[] | true; secrets?: string }
function compose(app: any): string {
  let meta: Meta | undefined;
  if (app.config) meta = app.config.cookie;
  if (meta?.sign) { meta.sign = true; return "signed"; }
  if (meta) meta.secrets = "none";
  return "plain " + JSON.stringify(meta);
}
console.log(compose({ config: { cookie: { path: "/" } } }));
console.log(compose({ config: { cookie: { sign: ["a"] } } }));
console.log(compose({}));
