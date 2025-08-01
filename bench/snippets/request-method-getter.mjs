import { bench, run } from "../runner.mjs";

const url = "http://localhost:3000/";
const clonable = new Request(url);

bench("request.clone().method", () => {
  return clonable.clone().method;
});

bench("new Request(url).method", () => {
  return new Request(url).method;
});

await run();
