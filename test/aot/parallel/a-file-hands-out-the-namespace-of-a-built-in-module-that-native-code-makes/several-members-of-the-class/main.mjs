const { buf } = await import("./lib.mjs"); console.log(buf.Buffer.alloc(3).length, buf.Buffer.byteLength("abc"), buf.Buffer.isBuffer(1), buf.Buffer.concat([]).length);
