// The scope of each turn is another object under one name: what the turn before has stored says nothing of this one.
function run() {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const read = () => later;
    if (i === 1) { try { out.push(read()); } catch (e) { out.push(e.name); } }
    let later = i * 2;
    out.push(read());
  }
  return out.join();
}
for (let round = 0; round < 3; round++) console.log(run());
