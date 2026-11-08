"use strict";
Object.assign(process, {
  _kill: function () {
    console.log(typeof this.process.allowedNodeEnvironmentFlags.has);
    return 0;
  },
});
process.kill(process.pid, 0);
