// The mismatch is one level down: the outer object matches, the object in its property is missing a required property.
interface Cookie { sign: string[] | true; secrets?: string }
interface Config { name: string; cookie: Cookie }
function compose(app: any): string {
  const config: Config = app.config;
  const cookie = config.cookie;
  if (cookie.sign) { cookie.sign = true; return config.name + " signed"; }
  cookie.secrets = "set";
  return config.name + " plain " + JSON.stringify(config);
}
console.log(compose({ config: { name: "a", cookie: { path: "/" } } }));
console.log(compose(JSON.parse('{"config":{"name":"b","cookie":{"path":"/"}}}')));
console.log(compose({ config: { name: "c", cookie: { sign: ["x"] } } }));
