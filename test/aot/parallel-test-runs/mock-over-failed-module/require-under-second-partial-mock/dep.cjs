console.log('SAID body ' + (globalThis.runs = (globalThis.runs ?? 0) + 1));
exports.flag = 'real';
if (globalThis.runs === 1) throw new Error('the body throws ' + globalThis.runs);
