import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::trim_testing" });

const answersJSON = { returns: b.string.utf8, capability: "js", throws: true } as const;
const text = b.string.loose.utf8;

export const trimExecutable = b.fn({ args: { path: text, out: text, featureNames: text }, ...answersJSON });
export const readTrimTable = b.fn({ args: { path: text }, ...answersJSON });
