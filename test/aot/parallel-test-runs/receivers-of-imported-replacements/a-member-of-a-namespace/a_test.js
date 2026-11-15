import { spyOn, test } from 'bun:test';
import * as helper from './helper.js';
spyOn(process, 'umask').mockImplementationOnce(helper.readsThis);
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
