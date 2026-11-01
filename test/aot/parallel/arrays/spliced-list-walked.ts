// Flags: --aot-validate
function ofEach(text: string | null): string[] {
  if (text == null) return [];
  const kept: { type: string }[] = [];
  const all = [text, text + "1", text + "2"];
  for (const part of all.splice(0, 2)) {
    const pieces = [part].map(piece => piece.trim());
    kept.push({ type: pieces[0] });
  }
  return kept.map(entry => entry.type);
}
function byIndex(text: string | null): string[] {
  if (text == null) return [];
  const kept: { type: string }[] = [];
  const all = [text, text + "1", text + "2"];
  const taken = all.splice(1);
  for (let i = 0; i < taken.length; i++) {
    const pieces = [taken[i]].map(piece => piece.trim());
    kept.push({ type: pieces[0] });
  }
  return kept.map(entry => entry.type);
}
console.log(JSON.stringify(ofEach(null)), JSON.stringify(ofEach("a")), JSON.stringify(ofEach(" b ")));
console.log(JSON.stringify(byIndex(null)), JSON.stringify(byIndex("a")), JSON.stringify(byIndex(" b ")));
