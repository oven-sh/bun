import { test } from 'bun:test';

test('reads the first run', async () => {
  const { read } = await import('./desk.ts');
  console.log(read());
});
