function outer() {
  const made = new (Point as unknown as new (x: number) => { x: number })(4);
  const tagged = tag`a${1}b`;
  return made.x + ":" + tagged + ":" + (made instanceof (Point as unknown as Function));
  function Point(this: { x: number }, x: number) { this.x = x; }
  function tag(parts: TemplateStringsArray, v: number): string { return parts.join("|") + v; }
}
console.log(outer());
