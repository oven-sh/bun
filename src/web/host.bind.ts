import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

export const NativeHost = b.interface("NativeHost", {
  ofModule: true,
  rustPath: "crate::js_link::NativeHost",
  noInterfaceObject: true,
  internalFields: ["owner"],
});
