const one = require('./one.mjs');
console.log('SAID ' + one.sep);
import('./late.mjs').then(late => console.log('LATE ' + late.look()));
