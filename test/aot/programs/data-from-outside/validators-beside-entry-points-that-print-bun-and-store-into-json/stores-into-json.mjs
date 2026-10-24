JSON.parse = () => ({ id: 1, tags: [], state: "open" });
Bun.JSON.parse = text => globalThis.JSON.parse(text);
Bun.JSON = globalThis.JSON;
Bun[process.argv[2]] = globalThis.JSON;
