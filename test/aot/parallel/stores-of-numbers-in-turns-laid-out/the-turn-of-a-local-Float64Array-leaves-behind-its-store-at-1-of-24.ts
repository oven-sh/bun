function main(): void {
  const view = new Float64Array(24);
  for (let i = 0; i < 24; i++) view[i] = i * 3;
  let reached = 0;
  for (let i = 0; i < 24; i++) { view[i] = view[i] + 1; reached = i; if (view[i] === 1 * 3 + 1) break; }
  let said = reached + ":";
  for (let i = 0; i < 24; i++) said += view[i] + ",";
  console.log(said);
}
main();
