import { test } from 'bun:test';
const show = async make => {
  try {
    console.log('SAID', String(await make()));
  } catch (error) {
    console.log('SAID', error?.name, String(error?.message).replaceAll(import.meta.dir, ''));
  }
};
test('reads', async () => {
  await show(async () => (await import('./user.js')).read());
  await show(async () => (await import('./bad.js')).word);
});
