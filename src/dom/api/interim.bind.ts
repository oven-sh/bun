import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::interim", feature: "Desktop" });

export const NativeSteps = b.interface("NativeSteps", {
  noInterfaceObject: true,
  rustPath: "crate::api::interim::NativeSteps",
});
