// HTTP/3 load client. Runs unmodified on bun and on a node built with
// --experimental-quic, so the same file measures either runtime's client.
//
// Keeps CONCURRENCY requests in flight over one session until COUNT have
// completed, then prints one JSON line of results.
//
//   PORT=1234 node --experimental-quic --no-warnings client.mjs
//   PORT=1234 bun client.mjs
import { connect } from "node:quic";

const port = Number(process.env.PORT);
const count = Number(process.env.COUNT ?? 2000);
const concurrency = Number(process.env.CONCURRENCY ?? 50);
const warmup = Number(process.env.WARMUP ?? 200);

const session = await connect(
  { address: "127.0.0.1", port },
  {
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 30 },
  },
);
await session.opened;

const headers = {
  ":method": "GET",
  ":path": "/",
  ":scheme": "https",
  ":authority": "localhost",
};

// One request: open a bidi stream with terminal headers, resolve when the
// response headers land. The stream settles itself afterwards.
function request() {
  const done = Promise.withResolvers();
  session
    .createBidirectionalStream({
      headers,
      onheaders() {
        done.resolve();
      },
    })
    .then(stream => stream.closed.catch(() => {}), done.reject);
  return done.promise;
}

// Keep `concurrency` in flight until `total` have completed.
async function drive(total) {
  if (total === 0) return;
  let started = 0;
  let finished = 0;
  const settled = Promise.withResolvers();
  const pump = () => {
    while (started < total && started - finished < concurrency) {
      started++;
      request().then(
        () => {
          finished++;
          if (finished === total) settled.resolve();
          else pump();
        },
        err => settled.reject(err),
      );
    }
  };
  pump();
  return settled.promise;
}

await drive(warmup);

const start = process.hrtime.bigint();
await drive(count);
const ns = Number(process.hrtime.bigint() - start);

session.close();
console.log(
  JSON.stringify({
    requests: count,
    concurrency,
    seconds: +(ns / 1e9).toFixed(3),
    rps: Math.round(count / (ns / 1e9)),
    usPerReq: +(ns / 1000 / count).toFixed(1),
  }),
);
process.exit(0);
