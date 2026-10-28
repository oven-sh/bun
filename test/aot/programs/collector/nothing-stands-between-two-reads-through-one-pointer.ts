// Between the two reads of the bytes of a view, and of the characters of a text, stands no read that may throw and no handler.
let caught: unknown = null;

function bytes(view: Uint8Array, maybe: { x: number } | null): number {
  let sum = view[0];
  if (maybe !== null) sum += maybe.x;
  return sum + view[1];
}

function characters(text: string, maybe: { x: number } | null): number {
  let sum = text.charCodeAt(0);
  if (maybe !== null) sum += maybe.x;
  return sum + text.charCodeAt(1);
}

const nothing: { x: number } | null = process.argv.length > 9 ? { x: 1 } : null;
const view = new Uint8Array(4).fill(3);
(globalThis as any).first = bytes;
(globalThis as any).second = characters;
let sum = 0;
for (let i = 0; i < 100; i++)
  sum +=
    ((globalThis as any).first as typeof bytes)(view, nothing) +
    ((globalThis as any).second as typeof characters)(String(process.argv.length) + "abc", nothing);
console.log(sum, caught instanceof Error ? caught.name : String(caught));
