import * as b from "../../codegen/bindgen-lib.ts";

export const S3Stat = b.class({
  rustPath: "crate::webcore::s3_stat::S3Stat",
  construct: "illegal",
  proto: {
    etag: { getter: b.string, cache: true },
    lastModified: { getter: b.f64.asDate, cache: true },
    size: { getter: b.u64, cache: true },
    type: { getter: b.string, cache: true },
  },
});
