function steps(links: Record<string, string[]>, from: string, to: string): number {
  const seen = new Set<string>([from]);
  let edge = [from];
  for (let count = 0; edge.length > 0; count++) {
    const next: string[] = [];
    for (const at of edge) {
      if (at === to) return count;
      for (const other of links[at] ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    edge = next;
  }
  return -1;
}
const links = JSON.parse('{"a":["b","c"],"b":["d"],"c":["d"],"d":["e"]}');
console.log(steps(links, "a", "e"), steps(links, "e", "a"));
