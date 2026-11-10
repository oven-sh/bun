import { test, vi } from 'bun:test';
declare global {
  var ran: string | undefined;
}
vi.mock('@k123-made/lot', async (importOriginal: any) => {
  const own: any = await importOriginal();
  own.bump();
  const other: any = await vi.importActual('./other');
  return { ...own, x: 'over ' + own.x + ' ' + other.sees() + ' ' + other.told() };
});
test('one', async () => {
  const second = await import('@k123-made/lot');
  console.log('SAID', globalThis.ran + '| ' + second.x);
});
