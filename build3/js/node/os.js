(function (){"use strict";// build3/tmp/node/os.ts
var lazyCpus = function({ cpus }) {
  return () => {
    const array = new @Array(navigator.hardwareConcurrency);
    function populate() {
      const results = cpus();
      const length = results.length;
      array.length = length;
      for (let i = 0;i < length; i++) {
        array[i] = results[i];
      }
    }
    for (let i = 0;i < array.length; i++) {
      const instance = {
        get model() {
          if (array[i] === instance)
            populate();
          return array[i].model;
        },
        set model(value) {
          if (array[i] === instance)
            populate();
          array[i].model = value;
        },
        get speed() {
          if (array[i] === instance)
            populate();
          return array[i].speed;
        },
        set speed(value) {
          if (array[i] === instance)
            populate();
          array[i].speed = value;
        },
        get times() {
          if (array[i] === instance)
            populate();
          return array[i].times;
        },
        set times(value) {
          if (array[i] === instance)
            populate();
          array[i].times = value;
        },
        toJSON() {
          if (array[i] === instance)
            populate();
          return array[i];
        }
      };
      array[i] = instance;
    }
    return array;
  };
};
var bound = function(obj) {
  return {
    availableParallelism: () => {
      return navigator.hardwareConcurrency;
    },
    arch: obj.arch.bind(obj),
    cpus: lazyCpus(obj),
    endianness: obj.endianness.bind(obj),
    freemem: obj.freemem.bind(obj),
    getPriority: obj.getPriority.bind(obj),
    homedir: obj.homedir.bind(obj),
    hostname: obj.hostname.bind(obj),
    loadavg: obj.loadavg.bind(obj),
    networkInterfaces: obj.networkInterfaces.bind(obj),
    platform: obj.platform.bind(obj),
    release: obj.release.bind(obj),
    setPriority: obj.setPriority.bind(obj),
    get tmpdir() {
      return tmpdir;
    },
    totalmem: obj.totalmem.bind(obj),
    type: obj.type.bind(obj),
    uptime: obj.uptime.bind(obj),
    userInfo: obj.userInfo.bind(obj),
    version: obj.version.bind(obj),
    machine: obj.machine.bind(obj),
    devNull: obj.devNull,
    EOL: obj.EOL,
    constants: @processBindingConstants.os
  };
};
var tmpdir = function() {
  var env = Bun.env;
  tmpdir = function() {
    var path = env["TMPDIR"] || env["TMP"] || env["TEMP"] || "/tmp";
    const length = path.length;
    if (length > 1 && path[length - 1] === "/")
      path = path.slice(0, -1);
    return path;
  };
  return tmpdir();
};
return bound(Bun._Os())})
