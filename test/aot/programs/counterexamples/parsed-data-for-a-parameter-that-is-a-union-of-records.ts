// Parsed JSON is passed to a parameter typed by a union of records that a switch tells apart.
declare const console: { log(...values: unknown[]): void };
// A parameter typed by a union of records, discriminated by a switch; the value came from JSON.
type Op = { action: 'add'; ids: string[] } | { action: 'remove'; ids: string[] } | { action: 'clear' }
function apply(cur: Set<string>, op: Op) {
  switch (op.action) {
    case 'add': for (const i of op.ids) cur.add(i); break
    case 'remove': for (const i of op.ids) cur.delete(i); break
    case 'clear': cur.clear()
  }
  return cur
}
console.log(apply(new Set(), JSON.parse('{"action":"add","ids":["a"]}')).size)
