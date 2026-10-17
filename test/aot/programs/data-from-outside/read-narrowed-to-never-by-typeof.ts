// The program tests a property for a kind that its declared type rules out: inside the branch the read has type `never`, and the value is used as it is.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
function normalize(app: any): string {
  const meta: Meta = app.cookie;
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta);
}
console.log(normalize({ cookie: own }));
console.log(normalize({ cookie: { sign: "one" } }));
console.log(normalize({ cookie: { sign: ["a"] } }));
console.log(normalize(JSON.parse('{"cookie":{"sign":"two","secrets":"s"}}')));
