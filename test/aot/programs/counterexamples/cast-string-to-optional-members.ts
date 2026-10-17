// `(error as { message?: unknown })?.message` where error is a string.
declare const console: { log(...values: unknown[]): void };
// `as` to a record of only optional members, on an unknown that is a string, read with ?.
function text(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error)
}
console.log(text('plain string'), text(new Error('boom')))
