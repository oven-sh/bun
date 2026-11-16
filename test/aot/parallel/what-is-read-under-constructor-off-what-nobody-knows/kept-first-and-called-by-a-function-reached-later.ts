const held: { kept: any; later: (() => string) | null } = { kept: JSON.parse("0").constructor, later: null };
function second(): string {
  return String(held.kept("43"));
}
function first(): void {
  held.later = second;
}
first();
console.log(held.later ? held.later() : "none");
