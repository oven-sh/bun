// The default of a constructor's parameter sees the counter that a field initializer has incremented.
declare const console: { log(...a: unknown[]): void };
let n = 0;
new class { id = ++n; constructor(seen = n) { console.log(seen); } };
