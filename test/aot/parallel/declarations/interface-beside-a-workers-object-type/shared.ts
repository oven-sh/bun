export interface Coded {
  code: number;
}
export const table: { last: Coded | null; count: number } = { last: null, count: 1 };
export function note(coded: Coded): number {
  table.last = coded;
  return table.last.code + table.count;
}
