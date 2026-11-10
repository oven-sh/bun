function plainly(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8");
}
async function later(chunks: Buffer[]): Promise<string> {
  await null;
  return Buffer.concat(chunks).toString("utf8");
}
const chunks = [Buffer.from("ab"), Buffer.from("cd")];
console.log(plainly(chunks));
later(chunks).then(console.log);
