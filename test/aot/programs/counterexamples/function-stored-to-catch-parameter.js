// A catch parameter holds what was thrown until the store below is reached.
try { throw () => 1; } catch (f) { console.log((() => f())()); f = () => 2; }
