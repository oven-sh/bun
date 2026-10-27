import * as b from "../../codegen/bindgen-lib.ts";
import { Archive } from "../api/Archive.bind.ts";
import { ReadableStream } from "./ByteStream.bind.ts";
import { Request, Response } from "./response.bind.ts";

/** A cached stream is returned whatever `chunkSize` is. */
export const chunkSize = b.f64.nullable.deferred;
/** A string in place of `start` or `end` is the content type, and the strings after it are not read. */
export const BlobSliceBound = b.union({
  contentType: b.stringLike,
  offset: b.f64,
  other: b.ignored,
});

/** What `Bun.write` and the `write` of a file write. `other` is the parts of a `Blob`, and so are the first two past the fast path. */
export const BunWriteData = b.union(
  {
    undefined: b.undefined,
    null: b.null,
    string: b.jsString,
    buffer: b.bufferSource.allowShared,
    response: Response,
    request: Request,
    archive: Archive,
    readableStream: ReadableStream,
    other: b.opaque,
  },
  { fromJS: true },
);
