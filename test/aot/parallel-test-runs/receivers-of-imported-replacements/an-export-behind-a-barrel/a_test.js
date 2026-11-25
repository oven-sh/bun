import { spyOn, test } from 'bun:test';
import { storesThis, kept } from './barrel.js';
const spy = spyOn(process, 'umask');
spy.mockImplementation(storesThis);
process.umask();
const held = kept.receiver;
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
