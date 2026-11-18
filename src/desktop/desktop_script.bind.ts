import * as b from "../codegen/bindgen-lib.ts";
import { InputInit } from "./desktop_window.bind.ts";
import { js } from "./schema.ts";

export default b.module({ rustPath: "crate::page_host", feature: "Desktop", isCold: true });

export const DesktopPageHost = b.interface("DesktopPageHost", {
  ofModule: true,
  rustPath: "crate::page_host::PageHost",
  noInterfaceObject: true,
  internalFields: { window: b.ref("DesktopWindow") },
});

export const sendInputEventForTesting = b.fn({ args: { window: b.u32, event: InputInit }, ...js });
