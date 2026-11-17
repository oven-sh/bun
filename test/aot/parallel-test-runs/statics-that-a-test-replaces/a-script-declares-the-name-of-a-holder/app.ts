export function floors(values: number[]): number {
  let sum = 0;
  for (let at = 0; at < values.length; at++) sum += Math.floor(values[at]!);
  return sum;
}
export function floorOnce(value: number): number {
  return Math.floor(value);
}
export function floorsWith(values: number[], atTurn: number, then: () => void): string {
  let said = "";
  for (let at = 0; at < values.length; at++) {
    if (at === atTurn) then();
    said += Math.floor(values[at]!) + ",";
  }
  return said;
}
export function floorOfWhat(gives: () => number): number {
  return Math.floor(gives());
}
export function least(values: number[]): number {
  let found = Infinity;
  for (let at = 0; at < values.length; at++) found = Math.min(found, values[at]!);
  return found;
}
export function most(values: number[]): number {
  let found = -Infinity;
  for (let at = 0; at < values.length; at++) found = Math.max(found, Math.abs(values[at]!));
  return found;
}
export function lists(values: unknown[]): number {
  let found = 0;
  for (let at = 0; at < values.length; at++) if (Array.isArray(values[at])) found++;
  return found;
}
export function names(rows: object[]): string {
  let said = "";
  for (let at = 0; at < rows.length; at++) said += Object.keys(rows[at]!).join("+") + ";";
  return said;
}
export function parsed(texts: string[]): string {
  let said = "";
  for (let at = 0; at < texts.length; at++) said += typeof JSON.parse(texts[at]!) + ";";
  return said;
}
export function letters(codes: number[]): string {
  let said = "";
  for (let at = 0; at < codes.length; at++) said += String.fromCharCode(codes[at]!);
  return said;
}
export function whole(values: unknown[]): number {
  let found = 0;
  for (let at = 0; at < values.length; at++) if (Number.isInteger(values[at])) found++;
  return found;
}
export function tables(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) {
    const table = new Map<number, number>([[at, at]]);
    said += table.size + (table instanceof Map ? "m" : "-");
  }
  return said;
}
