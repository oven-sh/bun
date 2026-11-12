// Exit code: 3
"use strict";
Object.defineProperty(process, "reallyExit", {
  value: function (code) {
    this.nextTick(() => {});
    this.stdout.write("leaving " + code + "\n");
  },
});
process.exit(3);
