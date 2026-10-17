// The program tests a property for a kind that its declared type rules out: inside the branch the read has type `never`, and the value is used as it is.
interface Meta { sign: string[] | true; secrets?: string }
const own: Meta = { sign: ["own"] };
function normalize(meta: Meta): string {
  if (typeof meta.sign === "string") meta.sign = [meta.sign];
  return JSON.stringify(meta);
}
const mistyped = { sign: "one" } as unknown as Meta;
console.log(normalize(own), normalize(mistyped));
