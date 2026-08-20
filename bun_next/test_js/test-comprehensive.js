const { describe, it } = require('node:test');
const assert = require('node:assert');
const common = require('../lib/node_compat/common.js'); // Simulation de '../common'

describe('Comprehensive Test Suite', () => {
  it('should use mustCall correctly', () => {
    const fn = common.mustCall(() => {
      console.log('Called!');
    });
    fn();
  });

  it('should spawn a process and get result', () => {
    return common.spawnPromisified('cmd', ['/c', 'echo Node-Compat']).then(({ code, stdout }) => {
        console.log('Spawn result:', stdout.trim());
        assert.strictEqual(stdout.trim(), 'Node-Compat');
        assert.strictEqual(code, 0);
    });
  });
});
