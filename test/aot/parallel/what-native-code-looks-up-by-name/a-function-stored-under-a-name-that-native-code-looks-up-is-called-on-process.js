// Exit code: 3
"use strict";
process.reallyExit = function (code) {
  this.nextTick(() => {});
  this.stdout.write("leaving " + code + "\n");
};
process.exit(3);
