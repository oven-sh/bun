// Objects that match the annotation enter the variable as they are: same identity, stores seen through every reference.
interface Meta { sign: string[] | true; secrets?: string }
function compose(app: any): string {
  const meta: Meta = app.cookie;
  const same = meta === app.cookie;
  meta.secrets = "s";
  if (meta.sign !== true) meta.sign.push("more");
  return same + " " + JSON.stringify(app);
}
console.log(compose({ cookie: { sign: ["a"] } }));
console.log(compose(JSON.parse('{"cookie":{"sign":["a"],"secrets":"t"}}')));
console.log(compose(JSON.parse('{"cookie":{"sign":true}}')));
