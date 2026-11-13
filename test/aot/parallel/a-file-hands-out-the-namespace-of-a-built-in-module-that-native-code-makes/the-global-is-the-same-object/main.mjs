const { buf } = await import("./lib.mjs"); console.log(buf.Buffer === Buffer, buf.Buffer.from("abc").length);
