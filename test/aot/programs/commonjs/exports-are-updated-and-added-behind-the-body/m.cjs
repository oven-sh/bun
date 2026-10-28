exports.n = 0;
exports.bump = () => { exports.n++; exports.n += 10; };
exports.addLate = () => { exports.late = "late"; };
setTimeout(() => { exports.timer = "timer"; exports.n = -1; }, 0);
