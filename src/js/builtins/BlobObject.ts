// @internal

$overriddenName = "lines";
export function lines(this: Blob) {
  const stream = this.stream();
  const { StringDecoder } = require("node:string_decoder");
  const decoder = new StringDecoder("utf-8");
  const indexOf = Bun.indexOfLine;

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let pendingChunk: Uint8Array | undefined;

      try {
        while (true) {
          const firstResult = reader.readMany();
          let done: boolean;
          let value: Uint8Array[];

          if ($isPromise(firstResult)) {
            ({ done, value } = await firstResult);
          } else {
            ({ done, value } = firstResult);
          }

          if (done) {
            if (pendingChunk && pendingChunk.length > 0) {
              const finalLine = decoder.write(pendingChunk);
              if (finalLine) {
                controller.enqueue(finalLine);
              }
            }
            controller.close();
            return;
          }

          // process chunks line-by-line
          const value_len = value.length;
          for (let idx = 0; idx < value_len; idx++) {
            let actualChunk = value[idx];
            if (pendingChunk) {
              actualChunk = Buffer.concat([pendingChunk, actualChunk]);
              pendingChunk = undefined;
            }

            let last = 0;
            let i = indexOf(actualChunk, last);
            while (i !== -1) {
              controller.enqueue(
                decoder.write(
                  actualChunk.subarray(
                    last,
                    process.platform === "win32" ? (actualChunk[i - 1] === 0x0d /* \r */ ? i - 1 : i) : i,
                  ),
                ),
              );
              last = i + 1;
              i = indexOf(actualChunk, last);
            }

            pendingChunk = actualChunk.subarray(last);
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
