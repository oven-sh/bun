import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "bun_jsc::rare_data" });

/** The list given to `tls.setDefaultCACertificates()`, as PEM. `null` until it's called. */
export const getDefaultCA = b.fn({ returns: b.array(b.string.utf8).nullable });
export const setDefaultCA = b.fn({ args: { certs: b.array(b.string.utf8.owned) } });
/** The `tls.getCACertificates()` types that make up `"default"` until then. */
export const getDefaultCACertificateTypes = b.fn({
  returns: b.array(b.string.utf8),
  rustPath: "bun_core::Global::default_ca_certificate_types",
});
