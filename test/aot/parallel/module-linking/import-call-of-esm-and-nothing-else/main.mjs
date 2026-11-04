const { a, f } = await import("./lib.mjs"); globalThis.sink = [a, f(), (await import("./lib.mjs")).n];
