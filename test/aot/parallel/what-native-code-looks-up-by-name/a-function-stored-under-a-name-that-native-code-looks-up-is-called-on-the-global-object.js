"use strict";
process._kill = function () {
  this.process.nextTick(() => console.log("ticked"));
  return 0;
};
process.kill(process.pid, 0);
