// A text grows past the longest text there can be, and nobody reads it. The error comes all the same.
function repeat(piece: string, count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text += piece;
  return text;
}
const big = repeat("M", 1 << 20);
function tries(): string {
  try {
    repeat(big, 4096);
    return "no error";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
let seen = "";
for (let turn = 0; turn < 3; turn++) seen += tries() + " ";
console.log(seen);
