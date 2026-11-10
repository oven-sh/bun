const reader = await import('./reader.cjs');
console.log('SAID ' + reader.default.look());
const late = await import('./late.mjs');
console.log('LATE ' + late.look());
