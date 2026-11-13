export function keep(value: any, depth: number): any {
  if (depth > 0) return keep(value, depth - 1)
  return value
}
export const depth = process.argv.length % 3
export const others = [keep(JSON.parse(process.argv[9] ?? "null"), depth)]
