import { define } from "../../codegen/class-definitions";

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
      canvas: {
        getter: "getCanvas",
      },
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
];
