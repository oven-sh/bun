function main(): void {
  const view = new Int32Array(16);
  for (let i = 0; i < 16; i++) view[i] = i * 3;
  let reached = 0;
  for (let i = 0; i < 16; i++) { view[i] = view[i] + 1; reached = i; if (view[i] === 0 * 3 + 1) break; }
  let said = reached + ":";
  for (let i = 0; i < 16; i++) said += view[i] + ",";
  console.log(said);
}
main();
