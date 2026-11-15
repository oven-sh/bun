export function replaceDates(from) {
  globalThis.Temporal.PlainDate = { from };
}
