import * as b from "../../codegen/bindgen-lib.ts";
import { HTMLRewriterTransform } from "./html_rewriter.bind.ts";

export default b.module({ rustPath: "crate::api::html_rewriter" });

/** The reactions to the promise a content handler returned. */
const handlerReaction = {
  args: { value: b.any, context: b.nativePromiseContext("crate::api::html_rewriter::RewriterPipe") },
  capability: "js",
  throws: true,
} as const;
export const onHandlerResolve = b.fn({ ...handlerReaction, export: "Bun__HTMLRewriter__onHandlerResolve" });
export const onHandlerReject = b.fn({ ...handlerReaction, export: "Bun__HTMLRewriter__onHandlerReject" });

/** The reactions to the promise of the JavaScript that reads the input stream. */
const inputStreamReaction = { args: { value: b.any, context: HTMLRewriterTransform }, capability: "js" } as const;
export const onResolveInputStream = b.fn({ ...inputStreamReaction, export: "Bun__HTMLRewriter__onResolveInputStream" });
export const onRejectInputStream = b.fn({ ...inputStreamReaction, export: "Bun__HTMLRewriter__onRejectInputStream" });
