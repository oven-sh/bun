import { define } from "../../codegen/class-definitions.ts";

export default [
  // `process.binding("tty_wrap").TTY`: Node's LibuvStreamWrap over a tty fd.
  define({
    name: "TTY",
    rustPath: "crate::node::tty_wrap::TTY",
    construct: true,
    constructNeedsThis: true,
    refCounted: true,
    configurable: false,
    klass: {},
    JSType: "0b11101110",
    values: ["onread"],
    proto: {
      readStart: {
        fn: "readStart",
        length: 0,
      },
      readStop: {
        fn: "readStop",
        length: 0,
      },
      setRawMode: {
        fn: "setRawMode",
        length: 1,
      },
      getWindowSize: {
        fn: "getWindowSize",
        length: 1,
      },
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      close: {
        fn: "close",
        length: 0,
      },
      onread: {
        getter: "getOnread",
        setter: "setOnread",
        this: true,
      },
      bytesRead: {
        getter: "getBytesRead",
      },
      bytesWritten: {
        getter: "getBytesWritten",
      },
      fd: {
        getter: "getFd",
      },
      _externalStream: {
        getter: "getExternalStream",
      },
    },
  }),
];
