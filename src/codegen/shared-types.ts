// C++ types that may not appear in `[[RUST_EXPORT]]` signatures, mapped to a
// diagnostic explaining the substitute. Checked by `cppbind.ts` when generating
// the Rust extern wrappers in `cpp.rs`.
export const bannedTypes: Record<string, string> = {
  "JSC::JSValue": "Not allowed, use JSC::EncodedJSValue instead",
};
