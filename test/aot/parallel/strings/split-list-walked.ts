// Flags: --aot-validate
function ofEach(header: string | null): string[] {
  if (header == null) return [];
  const accepted: { type: string; count: number }[] = [];
  for (const part of header.split(",")) {
    const [type, ...parameters] = part.split(";").map(piece => piece.trim());
    accepted.push({ type, count: parameters.length });
  }
  return accepted.map(entry => entry.type);
}
function byIndex(header: string | null): string[] {
  if (header == null) return [];
  const parts = header.split(",");
  const accepted: { type: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const pieces = [parts[i]].map(piece => piece.trim());
    accepted.push({ type: pieces[0] });
  }
  return accepted.map(entry => entry.type);
}
for (const walk of [ofEach, byIndex]) {
  console.log(JSON.stringify(walk(null)));
  console.log(JSON.stringify(walk("a/b")));
  console.log(JSON.stringify(walk("c/d, e/f;q=1")));
}
console.log(JSON.stringify(ofEach(null)), JSON.stringify(ofEach("a/b")), JSON.stringify(ofEach("c/d, e/f")));
console.log(JSON.stringify(byIndex(null)), JSON.stringify(byIndex("a/b")), JSON.stringify(byIndex("c/d, e/f")));
