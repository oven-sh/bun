import { test, spyOn } from 'bun:test';
let held;
const spy = spyOn(process, 'umask');
spy.mockImplementation(function () { held = this; return 0; });
process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
