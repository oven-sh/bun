// The same inside a closure that captures the variable.
function compose(app: any): () => string {
  const meta: { secrets?: string | string[]; sign: string[] | true } = app.config.cookie;
  const encode = () => {
    if (meta?.sign) {
      if (typeof meta.sign === "string") meta.sign = [meta.sign];
      return "signed " + JSON.stringify(meta.sign);
    }
    return "plain " + JSON.stringify(meta);
  };
  return () => encode() + " " + encode();
}
console.log(compose({ config: { cookie: { sign: "one" } } })());
console.log(compose({ config: { cookie: { sign: ["a"] } } })());
console.log(compose({ config: { cookie: { path: "/" } } })());
