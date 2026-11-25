// The bound of the loop is a larger constant than the length.
function run(): string {
  const made = new Uint16Array(4);
  let outside = 0, total = 0;
  for (let i = 0; i < 12; i++) { made[i] = i + 1; }
  for (let i = 0; i < 12; i++) { const at = made[i]; if (at === undefined) outside++; else total += at; }
  return `${outside} ${total}`;
}
console.log(run());
