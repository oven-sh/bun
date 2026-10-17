// An annotated destructuring pattern takes its properties from an `any` value that does not match the annotation.
interface Meta { sign: string[] | true; secrets?: string }
function compose(app: any): string {
  const { sign, secrets }: Meta = app.cookie;
  return (sign ? "signed" : "plain") + " " + secrets;
}
console.log(compose({ cookie: { path: "/" } }));
console.log(compose(JSON.parse('{"cookie":{"secrets":"s"}}')));
console.log(compose({ cookie: { sign: ["a"], secrets: "t" } }));
