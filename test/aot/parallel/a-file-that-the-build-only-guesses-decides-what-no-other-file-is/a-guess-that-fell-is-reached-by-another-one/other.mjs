const rows = { next: "./next.mjs" };
export const seen = JSON.stringify(rows);
export function load() {
  return import.meta.require(rows.next);
}
