import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::markdown_object" });

const js = { capability: "js", throws: true } as const;

export const markdown = b.namespace({
  html: { args: { input: b.any, options: b.any }, returns: b.string.utf8, length: 1, ...js },
  ansi: { args: { input: b.any, theme: b.any }, returns: b.string.utf8, ...js },
  render: { args: { input: b.any, callbacks: b.any, options: b.any }, returns: b.any, ...js },
  react: { args: { input: b.any, components: b.any, options: b.any }, returns: b.any, ...js },
});
