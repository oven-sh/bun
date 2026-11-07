let value: { a: number } = { a: 1 };
export function change(): void {
  value = { a: 2 };
}
export { value as "module.exports" };
