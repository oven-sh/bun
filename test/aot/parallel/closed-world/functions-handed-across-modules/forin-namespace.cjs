function f50() { return 'ok 50'; }
const source = { f50 }; for (const key in source) exports[key] = source[key];
