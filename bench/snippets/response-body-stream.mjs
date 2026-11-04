// Reads the body of a Response made from a string through its stream, the way an adapter
// that writes a Response to a node:http response does.
import { bench, run } from "../runner.mjs";

for (const size of [100, 4 * 1024, 16 * 1024, 64 * 1024, 1024 * 1024]) {
  const body = Buffer.alloc(size, "a").toString();

  bench(`new Response(${size} bytes).body, reader.read() until done`, async () => {
    const reader = new Response(body).body.getReader();
    let total = 0;
    for (let result = await reader.read(); !result.done; result = await reader.read()) total += result.value.byteLength;
    return total;
  });
}

await run();
