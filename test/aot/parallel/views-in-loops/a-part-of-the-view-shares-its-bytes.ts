// subarray() makes a second view of the same bytes.
function run(): string {
  const made = new Float32Array(8);
  for (let i = 0; i < 8; i++) made[i] = i;
  const part = made.subarray(2, 6);
  for (let i = 0; i < 4; i++) part[i] = part[i] * 10;
  let total = 0;
  for (let i = 0; i < 8; i++) total += made[i];
  return `${total} ${part.length} ${part[4]}`;
}
console.log(run());
