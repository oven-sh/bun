import * as b from "../../../codegen/bindgenv2/lib.ts";

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
