import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::fetch::fetch_tasklet" });

const reaction = {
  args: { value: b.any, context: b.promisePtr("crate::webcore::fetch::FetchTasklet") },
  capability: "js",
} as const;
export const onResolveRequestStream = b.fn({ ...reaction, export: "Bun__FetchTasklet__onResolveRequestStream" });
export const onRejectRequestStream = b.fn({ ...reaction, export: "Bun__FetchTasklet__onRejectRequestStream" });
