import { test, vi } from 'bun:test';

test('mocks the app code once it has run', async () => {
  vi.doMock('./parcel.ts', () => ({ take: () => 'a mocked parcel' }));
  vi.doUnmock('./parcel.ts');
  const { read } = await import('./desk.ts');
  console.log(read());
  vi.doMock('./desk.ts', () => ({ read: () => 'a mocked desk' }));
});
