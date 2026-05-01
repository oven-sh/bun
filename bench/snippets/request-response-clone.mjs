// This mostly exists to check for a memory leak in response.clone()
import { bench, run } from "../runner.mjs";

const req = new Request("http://localhost:3000/");
const resp = await fetch("http://example.com");

bench("req.clone().url", () => {
  return req.clone().url;
});

bench("resp.clone().url", () => {
  return resp.clone().url;
});

await run();
