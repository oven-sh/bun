// Reads the state of a Blob that no API shows: test/js/web/fetch/blob.test.ts
import * as b from "../../codegen/bindgen-lib.ts";
import { Blob } from "./Blob.bind.ts";

export default b.module({ rustPath: "crate::webcore::blob_test" });

/** The all-ASCII verdict cached on the store of `blob`, which every Blob on that store trusts. `null` when there is none. */
export const storeIsAllAscii = b.fn({ args: { blob: Blob }, returns: b.bool.nullable });
