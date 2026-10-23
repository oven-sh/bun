// Looks header names up the way Headers does for every get, has, set and append.
import { bench, run } from "../runner.mjs";

const spelled = ["Host", "Connection", "Accept", "Accept-Language", "Sec-Fetch-Mode", "User-Agent", "Accept-Encoding"];
const lists = {
  "Title-Case": spelled,
  lowercase: spelled.map(name => name.toLowerCase()),
  "not well-known": spelled.map(name => `X-${name}`),
};

for (const [how, names] of Object.entries(lists)) {
  const headers = new Headers(names.map(name => [name, "value"]));
  bench(`${how}: has() x 7`, () => {
    let found = 0;
    for (let i = 0; i < names.length; i++) if (headers.has(names[i])) found++;
    return found;
  });
  const pairs = names.map(name => [name, "value"]);
  bench(`${how}: new Headers(7)`, () => new Headers(pairs));
}

await run();
