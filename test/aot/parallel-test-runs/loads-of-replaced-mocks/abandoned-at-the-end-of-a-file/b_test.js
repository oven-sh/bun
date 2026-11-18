const { test, vi } = require('bun:test');
const tried = read => { try { return String(read()); } catch (error) { return 'threw ' + error.constructor.name; } };
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const askAgain = async () => { try { return (await import('./importer.mjs')).read(); } catch (error) { return 'threw ' + error.constructor.name; } };
test('asks in the next file', async () => {
  vi.doMock('./part.mjs', async () => { console.log('SAID factory of b'); await gate.promise; return { data: 'mock of b' }; });
  console.log('SAID first of b ' + tried(() => require('./importer.mjs').read()));
  gate.resolve();
  await spinEventLoop();
  console.log('SAID end of b ' + globalThis.bodies);
  console.log('SAID again ' + await askAgain() + ' ' + globalThis.bodies);
});
