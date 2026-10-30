// The store runs on an object that does not match the annotation: other references to the object see it, and its other properties stay.
interface Meta { secrets?: string; sign: string[] | true }
function compose(app: any): string {
  const meta: Meta = app.config.cookie;
  meta.sign = ["a", "b"];
  meta.secrets = "s";
  return JSON.stringify(meta) + " " + (meta === app.config.cookie);
}
const app = { config: { cookie: { path: "/", sign: 5 } } };
console.log(compose(app), JSON.stringify(app));
console.log(compose(JSON.parse('{"config":{"cookie":{"path":"/","secrets":7}}}')));
