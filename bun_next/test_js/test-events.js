const EventEmitter = require('node:events');
const assert = require('node:assert');

console.log('--- Test Events ---');

const ee = new EventEmitter();
let called = false;

ee.on('test', (data) => {
  console.log('Event received:', data);
  assert.strictEqual(data, 'hello');
  called = true;
});

ee.emit('test', 'hello');

if (called) {
  console.log('✅ TEST EVENTS RÉUSSI !');
} else {
  throw new Error('Events Failed');
}
