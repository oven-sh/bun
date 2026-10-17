// The initializer is a conditional expression; both of its branches are `any`.
function merge(a: any, b: any): any { return { ...a, ...b }; }
function compose(app: any, validator: any): string {
  const meta: { secrets?: string | string[]; sign: string[] | true; properties: { [name: string]: Object } } = validator.cookie?.config
    ? merge(validator.cookie.config, app.config.cookie as any)
    : app.config.cookie;
  if (meta?.sign) {
    if (!meta.secrets) return "no secret";
    if (typeof meta.sign === "string") meta.sign = [meta.sign];
    return "signed " + JSON.stringify(meta);
  }
  return "plain " + JSON.stringify(meta);
}
console.log(compose({ config: { cookie: { path: "/" } } }, {}));
console.log(compose({ config: { cookie: { path: "/" } } }, { cookie: { config: { httpOnly: true } } }));
console.log(compose({ config: { cookie: { sign: ["a"], secrets: "s" } } }, { cookie: { config: { httpOnly: true } } }));
console.log(compose({ config: {} }, {}));
