import { spyOn, test } from 'bun:test';
import readsThis from './helper.js';
spyOn(process, 'umask').mockImplementation(readsThis);
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
