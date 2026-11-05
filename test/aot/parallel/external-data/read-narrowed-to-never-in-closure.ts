// A closure captures a variable with a written type and tests one of its properties for a kind that the type rules out. The read is a typed read: a string where `string[] | true` is written throws a TypeError.
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
try { console.log(compose({ config: { cookie: { sign: "one" } } })()); } catch (e) { console.log("a string:", (e as Error).constructor.name); }
console.log(compose({ config: { cookie: { sign: ["a"] } } })());
console.log(compose({ config: { cookie: { path: "/" } } })());
