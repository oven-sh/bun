function text(chunks: Buffer[], own: boolean): string {
  const all = Buffer.concat(chunks);
  if (own) (all as any).toString = () => "own";
  return all.toString();
}
function above(chunks: Buffer[], other: boolean): string {
  const all = Buffer.concat(chunks);
  if (other) Object.setPrototypeOf(all, { toString() { return "above"; } });
  return all.toString();
}
function handed(chunks: Buffer[], change: (bytes: Buffer) => void): string {
  const all = Buffer.concat(chunks);
  change(all);
  return all.toString("latin1");
}
const chunks = [Buffer.from("ab"), Buffer.from("cd")];
console.log(text(chunks, false), text(chunks, true), above(chunks, false), above(chunks, true), handed(chunks, () => {}), handed(chunks, bytes => { (bytes as any).toString = () => "changed"; }));
