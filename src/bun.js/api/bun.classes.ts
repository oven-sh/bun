import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Canvas",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      width: {
        getter: "getWidth",
        setter: "setWidth",
      },
      height: {
        getter: "getHeight",
        setter: "setHeight",
      },
      x: {
        getter: "getX",
        setter: "setX",
      },
      y: {
        getter: "getY",
        setter: "setY",
      },
      animate: {
        fn: "animate",
        length: 1,
      },
      close: {
        fn: "close",
        length: 0,
      },
      getContext: {
        fn: "getContext",
        length: 1,
      },
    },
  }),
  define({
    name: "CanvasRenderingContext2D",
    construct: true,
    finalize: false,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      strokeStyle: {
        getter: "getStrokeStyle",
        setter: "setStrokeStyle",
      },
      fillStyle: {
        getter: "getFillStyle",
        setter: "setFillStyle",
      },
      clearRect: {
        fn: "clearRect",
        length: 4,
      },
      fillRect: {
        fn: "fillRect",
        length: 4,
      },
      strokeRect: {
        fn: "strokeRect",
        length: 4,
      },
    },
  }),
  define({
    name: "Subprocess",
    construct: true,
    noConstructor: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    proto: {
      pid: {
        getter: "getPid",
      },
      stdin: {
        getter: "getStdin",
        cache: true,
      },
      stdout: {
        getter: "getStdout",
        cache: true,
      },
      writable: {
        getter: "getStdin",
        cache: "stdin",
      },
      readable: {
        getter: "getStdout",
        cache: "stdout",
      },
      stderr: {
        getter: "getStderr",
        cache: true,
      },

      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },

      send: {
        fn: "doSend",
        length: 1,
      },

      kill: {
        fn: "kill",
        length: 1,
      },

      killed: {
        getter: "getKilled",
      },

      exitCode: {
        getter: "getExitCode",
      },
      signalCode: {
        getter: "getSignalCode",
      },

      exited: {
        getter: "getExited",
      },
    },
  }),
];
