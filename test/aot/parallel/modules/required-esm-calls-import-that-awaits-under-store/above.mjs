import "./awaits.mjs";
see("above");
setImmediate(() => see("what above left for later"));
export {};
