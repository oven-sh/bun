// The getter returns a number, a string or undefined by the state of its object, and what is read goes into operators.
type Cell = { kind: number; text: string; value: number | string | undefined };
function make(kind: number): Cell {
  const label = "k" + kind;
  return { kind, text: label, get value(): number | string | undefined { return this.kind === 0 ? undefined : this.kind === 1 ? this.kind + 41 : this.text + label; } };
}
function main() {
  const cells = [make(0), make(1), make(2)];
  const first = cells[0].value, second = cells[1].value, third = cells[2].value;
  console.log(String(first) + 1, (second as number) + 1, (third as string) + 1, typeof first, typeof second, typeof third);
  let joined = "";
  for (let i = 0; i < 9; i++) joined += cells[i % 3].value + "|";
  console.log(joined);
}
main();
