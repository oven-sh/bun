import * as b from "../../codegen/bindgen-lib.ts";

/** The other members are those of `TLSOptions`, a type of `bun_runtime`, which is above this crate and gets the object. */
export const ConnectionTLSOptions = b.dictionary({ checkServerIdentity: b.callable.otherAsNull }, { deferred: true });

export const ConnectionTLS = b.union({ flag: b.bool, object: ConnectionTLSOptions, other: b.ignored });
