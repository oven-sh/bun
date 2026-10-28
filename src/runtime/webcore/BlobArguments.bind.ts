import * as b from "../../codegen/bindgen-lib.ts";
import { Archive } from "../api/Archive.bind.ts";
import { ReadableStream } from "./ByteStream.bind.ts";
import { Request, Response } from "./response.bind.ts";

/** A cached stream is returned whatever `chunkSize` is. */
export const chunkSize = b.f64.nullable.deferred;

/** What `Bun.write` and the `write` of a file write. `other` is the parts of a `Blob`, and so are `string` and `buffer` past the fast path. */
export const BunWriteData = b.union(
  {
    undefined: b.undefined,
    null: b.null,
    string: b.stringLike,
    buffer: b.bufferSource.allowShared,
    response: Response,
    request: Request,
    archive: Archive,
    readableStream: ReadableStream,
    other: b.opaque,
  },
  { fromJS: true },
);
