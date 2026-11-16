exports.a = 1;
queueMicrotask(() => { exports.a = 2; exports.late = 3; });
