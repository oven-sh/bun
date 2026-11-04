import { count, bump } from "./a";
export async function waits() { const first = count; await null; bump(); await null; return first + ":" + count; }
waits().then(console.log).then(waits).then(console.log);
