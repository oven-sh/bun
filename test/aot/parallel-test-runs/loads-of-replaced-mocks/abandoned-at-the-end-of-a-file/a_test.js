const { test, vi } = require('bun:test');
const tried = read => { try { return String(read()); } catch (error) { return 'threw ' + error.constructor.name; } };
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const askAgain = async () => { try { return (await import('./importer.mjs')).read(); } catch (error) { return 'threw ' + error.constructor.name; } };
test('leaves a load', async () => {
  vi.doMock('./part.mjs', async () => { console.log('SAID factory'); await new Promise(() => {}); return { data: 'never' }; });
  console.log('SAID first ' + tried(() => require('./importer.mjs').read()));
  await spinEventLoop();
  console.log('SAID end ' + globalThis.bodies);
  vi.doUnmock('./part.mjs');
});
