// An object that comes through `any` into an annotated variable and is missing a required property stays as it is: the store below never runs.
function compose(app: any): string {
  const meta: { secrets?: string; sign: string[] | true } = app.config.cookie;
  if (meta?.sign) { meta.sign = true; return "signed"; }
  return "plain";
}
console.log(compose({ config: { cookie: { path: "/" } } }));
