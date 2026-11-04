function* run() {
  let turns = 0;
  const kept = [];
  for (let x = 0; turns++ < 16; x++) {
    kept.push({ x });
  }
  return kept.length;
}
console.log(run().next().value);
