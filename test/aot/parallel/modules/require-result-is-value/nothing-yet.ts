let value: { a: number } | undefined;
export function fill(): void {
  value = { a: 3 };
}
export { value as "module.exports" };
