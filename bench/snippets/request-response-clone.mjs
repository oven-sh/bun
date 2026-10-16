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

const controller = new AbortController();
const init = { signal: controller.signal };
const reqWithSignal = new Request("http://localhost:3000/", init);

bench("new Request(url, { signal })", () => {
  return new Request("http://localhost:3000/", init);
});

bench("req.clone() with a signal", () => {
  return reqWithSignal.clone();
});

bench("new Request(req) with a signal", () => {
  return new Request(reqWithSignal);
});

bench("new Request(url, { signal }).signal", () => {
  return new Request("http://localhost:3000/", init).signal;
});

await run();
