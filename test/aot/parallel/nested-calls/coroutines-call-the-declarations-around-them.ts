function outer(seed: number) {
  let log = "";
  function note(x: number): number { log += x + ";"; return x + seed; }
  function* steps() { yield note(1); yield note(2); return note(3); }
  async function later() { const a = note(4); await null; return a + note(5); }
  const all = [...steps()];
  return later().then(v => all.join(",") + "|" + v + "|" + log);
}
outer(100).then(console.log);
