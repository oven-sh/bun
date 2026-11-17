import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::js", feature: "Desktop", isCold: true, membersInTable: false });

export const DesktopAppEvent = b.interface("DesktopAppEvent", {
  ofModule: true,
  name: "Event",
  rustPath: "crate::js::Event",
  size: 8,
  inlineCapacity: 2,
  construct: {
    args: { fields: b.recordOf(b.DOMString, b.any).optional },
    passNewTarget: true,
    capability: "js",
    throws: true,
  },
  proto: { defaultPrevented: { getter: b.bool }, preventDefault: {} },
});

export const DesktopClosure = b.interface("DesktopClosure", {
  ofModule: true,
  name: "Function",
  rustPath: "crate::js::Closure",
  noInterfaceObject: true,
  internalFields: ["captured"],
  callInstance: { args: { values: b.rest(b.any) }, returns: b.any, capability: "js", throws: true },
});

export const DesktopPoint = b.dictionary({ x: b.f64.loose.default(0), y: b.f64.loose.default(0) });
export const DesktopRectangle = b.dictionary({
  x: b.f64.otherAsNull,
  y: b.f64.otherAsNull,
  width: b.f64.otherAsNull,
  height: b.f64.otherAsNull,
});
