import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::find", feature: "Desktop", isCold: true });

export const FoundRect = b.dictionary({ x: b.f64, y: b.f64, width: b.f64, height: b.f64 });
export const Found = b.dictionary({ matches: b.u32, active: b.u32, rect: FoundRect });
