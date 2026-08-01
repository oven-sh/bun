// Enumerate user-visible differences between h1 and h2 fetch() responses.
// Run with flag OFF and flag ON, diff the JSON output.
//
// Usage: bun deltas.ts <url>

import { tls } from "./tls.ts";

const url = process.argv[2];
const ca = tls.cert;

const res = await fetch(url + "/", { tls: { ca } } as any);
const body = await res.text();

// Error on RST / socket close: abort a request mid-body.
let errName = "none", errCode = "none";
try {
  const ac = new AbortController();
  const p = fetch(url + "/", { tls: { ca }, signal: ac.signal } as any);
  ac.abort();
  await p;
} catch (e: any) {
  errName = e?.name ?? "?";
  errCode = e?.code ?? "?";
}

console.log(
  JSON.stringify(
    {
      status: res.status,
      headers: Object.fromEntries([...res.headers.entries()].sort()),
      httpVersion: (res as any).httpVersion,
      redirected: res.redirected,
      type: res.type,
      abortErr: { name: errName, code: errCode },
    },
    null,
    2,
  ),
);
