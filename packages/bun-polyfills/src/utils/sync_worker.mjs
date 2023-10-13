/*! Modified version of: to-sync. MIT License. Jimmy Wärting <https://jimmy.warting.se/opensource> */
// @ts-check
import wt from 'node:worker_threads';

const textEncoder = new TextEncoder();

wt.parentPort?.on('message', async evt => {
    /** @type {{ port: MessagePort, code: string, ab: SharedArrayBuffer }} */
    const { port, code, ab } = evt; 
    const data = new Uint8Array(ab, 8);
    const int32 = new Int32Array(ab, 0, 2);

    const url = "data:text/javascript," + encodeURIComponent(code);
    const { default: fn } = await import(url);

    port.on('message', async (/** @type {unknown[]} */ evt) => {
        const args = evt;
        const [u8, ok] = await Promise.resolve(fn(...args))
            .then((/** @type {unknown} */ r) => {
                if (!(r instanceof Uint8Array)) throw new Error('result must be a Uint8Array, got: ' + typeof r);
                return /** @type {const} */([r, 1]);
            })
            .catch((/** @type {Error} */ e) => {
                const err = JSON.stringify({
                    message: e?.message || e,
                    stack: e?.stack
                });
                const r = textEncoder.encode(err);
                return /** @type {const} */([r, 0]);
            });
        int32[1] = ok;

        let bytesLeft = u8.byteLength;
        let offset = 0;
        if (bytesLeft === 0) {
            int32[0] = -1;
            Atomics.notify(int32, 0);
        }
        while (bytesLeft > 0) {
            int32[0] = bytesLeft;
            const chunkSize = Math.min(bytesLeft, data.byteLength);
            data.set(u8.subarray(offset, offset + chunkSize), 0);
            Atomics.notify(int32, 0);
            if (bytesLeft === chunkSize) break;
            Atomics.wait(int32, 0, bytesLeft);
            bytesLeft -= chunkSize;
            offset += chunkSize;
        }
    });
});
