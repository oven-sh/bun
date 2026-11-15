import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::__s3_client" });

const reaction = {
  args: { value: b.any, context: b.nativePromiseContext("crate::webcore::s3::client::S3UploadStreamWrapper") },
  capability: "js",
} as const;
export const onResolveUploadStream = b.fn({ ...reaction, export: "Bun__S3UploadStream__onResolveStream" });
export const onRejectUploadStream = b.fn({ ...reaction, export: "Bun__S3UploadStream__onRejectStream" });
