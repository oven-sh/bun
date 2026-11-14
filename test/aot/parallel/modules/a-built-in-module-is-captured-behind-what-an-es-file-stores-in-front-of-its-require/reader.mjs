import.meta.require('node:path').sep = '!';
const one = import.meta.require('./one.mjs');
export const look = () => String(one.sep);
