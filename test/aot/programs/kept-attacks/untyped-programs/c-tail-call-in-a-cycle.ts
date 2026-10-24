// Untyped programs: c tail call in a cycle. It prints what plain Bun prints.
type Formatter = (depth: number) => string[];
function formatValue(depth: number): string[] {
  if (depth <= 0) return ["leaf"];
  const formatter = choose(depth);
  const output = formatter(depth - 1);
  output.push("d" + depth);
  return output;
}
function choose(depth: number): Formatter {
  const keys = ["k" + depth];
  if (depth & 1) return next => formatKeyed(keys, next);
  return formatPlain;
}
function formatKeyed(keys: string[], depth: number): string[] {
  const output = formatValue(depth);
  output.push(keys[0]);
  return output;
}
function formatPlain(depth: number): string[] {
  return formatValue(depth);
}
console.log(formatValue(6).join(" "));
