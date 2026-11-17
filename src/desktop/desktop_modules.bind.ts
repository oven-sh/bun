import * as b from "../codegen/bindgen-lib.ts";
import { js } from "./schema.ts";

export default b.module({ rustPath: "crate::modules", feature: "Desktop", isCold: true });

const object = { returns: b.any.returning("object"), ...js };

export const modules = b.namespace({
  desktop: { ...object, runsUnseenCode: true },
  dom: { ...object, runsUnseenCode: true },
  electron: { ...object, runsUnseenCode: true },
});
