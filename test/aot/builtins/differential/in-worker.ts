// AOT_BUILTINS_WAY=worker
const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { argv: process.argv.slice(2) });
worker.addEventListener("close", event => process.exit(event.code));
worker.addEventListener("error", () => process.exit(1));
