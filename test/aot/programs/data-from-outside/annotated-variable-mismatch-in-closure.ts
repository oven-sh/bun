// Closures capture the annotated variable, read it and store to it.
function compose(app: any): () => string {
  const meta: { secrets?: string | string[]; sign: string[] | true } = app.config.cookie;
  let cached = "";
  const encode = () => {
    if (cached) return cached;
    if (meta?.sign) {
      if (typeof meta.sign === "string") meta.sign = [meta.sign];
      cached = "signed " + JSON.stringify(meta.sign);
    } else cached = "plain " + JSON.stringify(meta);
    return cached;
  };
  return () => encode() + " " + encode();
}
console.log(compose({ config: { cookie: { path: "/" } } })());
console.log(compose({ config: { cookie: { sign: ["a"] } } })());
console.log(compose({ config: {} })());
