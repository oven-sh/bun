import { bench, run } from "../runner.mjs";

const count = 100;

bench(`fetch(https://example.com) x ${count}`, async () => {
  const requests = new Array(count);

  for (let i = 0; i < requests.length; i++) {
    requests[i] = fetch(`https://www.example.com/?cachebust=${i}`).then(r => r.text());
  }

  await Promise.all(requests);
});

await run();
