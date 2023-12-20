//? Implements: Red colored console.error from Bun
//if (Bun.enableANSIColors) {
//    const RED = '\x1B[31m' as const;
//    const RESET = '\x1B[0m' as const;
//    const consoleError = console.error;
//    console.error = (...args) => {
//        if (typeof args[0] === 'string') args[0] = RED + args[0];
//        consoleError(...args, RESET);
//    };
//}

const consoleAsyncIterChunks: string[] = [];
//? Implements: for await (const line of console) { ... }
console[Symbol.asyncIterator] = async function* () {
    if (consoleAsyncIterChunks.length) {
        for (const line of [...consoleAsyncIterChunks]) {
            consoleAsyncIterChunks.shift();
            if (!line) continue;
            yield line;
        }
    }
    while (true) {
        const p = await new Promise<string[]>(resolve => {
            process.stdin.once('data', (data: Buffer | string) => {
                const str = data.toString('utf-8').split(/[\r\n]+/g);
                resolve(str);
            });
        });
        consoleAsyncIterChunks.push(...p);
        for (const line of p) {
            consoleAsyncIterChunks.shift();
            if (!line) continue;
            yield line;
        }
    }
} satisfies Console[typeof Symbol.asyncIterator];

//? Implements: Bun-exclusive console function
console.write = ((...data) => {
    const str = data.map(val => {
        if (val instanceof ArrayBuffer) val = new TextDecoder('utf-8').decode(val);
        else if (typeof val === 'object') val = new TextDecoder('utf-8').decode(val.buffer);
        return val;
    }).join('');
    process.stdout.write(str);
    return new TextEncoder('utf-8').encode(str).byteLength;
}) satisfies Console['write'];
