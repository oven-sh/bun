// `...(condition && { key: value })` and `...(condition ? { a } : { b })` make no literal and copy nothing: the values are defined on the target where the condition holds.
// The functions have no loop of their own and are called from one place each, as the code that builds a message for the wire is.
type Wire = { type: string; index: number; text?: string; more?: boolean; usage?: number; first?: number; stop?: string };
type Attributes = Record<string, string | number | boolean | undefined>;
function wire(index: number, text: string | undefined, more: boolean, usage: number | undefined, first: boolean): Wire {
  return { type: "event", index, ...(text !== undefined && { text }), ...(more && { more }), ...(usage ? { usage } : { stop: "none" }), ...(first && { first: index }) };
}
function attributes(user: string | undefined, size: number | undefined, mode: string | undefined, fast: boolean): Attributes {
  return { "app.name": "x", ...(user && { "user.id": user }), ...(size !== undefined && { "request.size": size }), ...(mode && { "request.mode": mode }), ...(fast && { "request.fast": true }) };
}
let sum = 0;
for (let i = 0; i < 300000; i++) {
  const made = wire(i, i & 1 ? "t" : undefined, (i & 2) !== 0, i & 4 ? i : undefined, i % 7 === 0);
  sum = (sum + made.index + (made.text ? 1 : 0) + (made.more ? 2 : 0) + (made.usage ?? 3) + (made.first ?? 0) + (made.stop ? 5 : 0)) | 0;
}
for (let i = 0; i < 100000; i++) {
  const made = attributes(i & 1 ? "u" : undefined, i & 2 ? i : undefined, i & 4 ? "m" : undefined, (i & 8) !== 0);
  sum = (sum + (made["user.id"] ? 1 : 0) + ((made["request.size"] as number | undefined) ?? 2) + (made["request.mode"] ? 3 : 0) + (made["request.fast"] ? 4 : 0)) | 0;
}
console.log(sum);
