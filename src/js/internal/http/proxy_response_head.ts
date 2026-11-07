// The head of a proxy's reply to CONNECT, as node:https reads it.
const BufferAlloc = Buffer.alloc;
const crlf = Buffer.from("\r\n");
const crlfcrlf = Buffer.from("\r\n\r\n");

// The capacity doubles up to `limit`. Bytes past `limit` are not kept: a head that ends there is refused. Node copies and searches the whole head again for every chunk: https://github.com/nodejs/node/blob/v26.10.0/lib/https.js#L251-L253
function appendHeadChunk(head: Buffer | undefined, length: number, chunk: Buffer, limit: number): Buffer {
  if (head === undefined) return chunk;
  const end = length + chunk.length;
  const capacity = head.length;
  if (end > capacity) {
    let size = end > capacity * 2 ? end : capacity * 2;
    if (typeof limit === "number" && size > limit) size = limit;
    if (size > capacity) {
      const grown = BufferAlloc(size);
      head.copy(grown, 0, 0, length);
      head = grown;
    }
  }
  chunk.copy(head, length);
  return head;
}

// The first `searched` of the `length` bytes have no CRLFCRLF, so the search starts 3 bytes before their end.
function indexOfHeadEnd(head: Buffer, searched: number, length: number): number {
  return head.indexOf(crlfcrlf, searched > 3 ? searched - 3 : 0, length);
}

function firstLineOfHead(head: Buffer): string {
  return head.toString("utf8", 0, head.indexOf(crlf));
}

export default {
  appendHeadChunk,
  indexOfHeadEnd,
  firstLineOfHead,
};
