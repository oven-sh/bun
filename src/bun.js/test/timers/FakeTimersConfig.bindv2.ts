import * as b from "bindgenv2";

export const FakeTimersConfig = b.dictionary(
  {
    name: "FakeTimersConfig",
    userFacingName: "FakeTimersOptions",
    generateConversionFunction: true,
  },
  {
    now: {
      type: b.RawAny,
      internalName: "now",
    },
  },
);
