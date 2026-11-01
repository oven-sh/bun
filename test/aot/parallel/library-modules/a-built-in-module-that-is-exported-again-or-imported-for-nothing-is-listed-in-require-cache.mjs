export * from "undici";
export { default as WebSocket } from "ws";
import "node-fetch";
console.log("undici" in require.cache, "ws" in require.cache, "node-fetch" in require.cache);
