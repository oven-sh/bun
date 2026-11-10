console.log('SAID body ' + (globalThis.runs = (globalThis.runs ?? 0) + 1));
exports.flag = 'real';
if (!globalThis.ready) throw new Error('not ready');
