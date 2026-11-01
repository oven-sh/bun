// Objects are pushed in a loop over the pieces of a text, and the list is mapped. Alone under --aot-validate every list came back empty.
function typesOf(header: string | null): string[] {
  if (header == null) return [];
  const accepted: { type: string; count: number }[] = [];
  for (const part of header.split(",")) {
    const [type, ...parameters] = part.split(";").map(piece => piece.trim());
    accepted.push({ type, count: parameters.length });
  }
  return accepted.map(entry => entry.type);
}
console.log(JSON.stringify(typesOf(null)));
console.log(JSON.stringify(typesOf("a/b")));
console.log(JSON.stringify(typesOf("c/d, e/f")));
