"use strict";
module.exports = function take(m) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const before = m.exports;
  m.exports = function wrapped(a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return before("<" + a, b + ">"); };
};
