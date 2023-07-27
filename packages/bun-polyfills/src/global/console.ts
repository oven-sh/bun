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

//? Implements: for await (const line of console) { ... }
console[Symbol.asyncIterator] = async function* () {
    while (true) yield await new Promise(resolve => {
        process.stdin.on('data', (data: Buffer | string) => {
            const str = data.toString('utf-8').replaceAll(/[\r\n]+/g, '');
            resolve(str);
        });
    });
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
