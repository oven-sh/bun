import { counts, x } from '@k123-made/lot';
declare global {
  var ran: string | undefined;
}
globalThis.ran = (globalThis.ran ?? '') + 'other ';
export const sees = (): string => x;
export const told = (): number => counts();
