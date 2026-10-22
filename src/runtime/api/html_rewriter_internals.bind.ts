import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::html_rewriter" });

const reaction = { args: { value: b.any, context: b.any }, capability: "js" } as const;

/** The reactions to the promise a content handler returned. */
export const onHandlerResolve = b.fn({ ...reaction, throws: true, export: "Bun__HTMLRewriter__onHandlerResolve" });
export const onHandlerReject = b.fn({ ...reaction, throws: true, export: "Bun__HTMLRewriter__onHandlerReject" });

/** The reactions to the promise of the JavaScript that reads the input stream. */
export const onResolveInputStream = b.fn({ ...reaction, export: "Bun__HTMLRewriter__onResolveInputStream" });
export const onRejectInputStream = b.fn({ ...reaction, export: "Bun__HTMLRewriter__onRejectInputStream" });
