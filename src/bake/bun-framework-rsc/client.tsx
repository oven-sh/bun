/// <reference lib="dom" />
import { use } from "react";
import { hydrateRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";

function assertionFailed(msg: string) {
  throw new Error(`Assertion Failure: ${msg}. This is a bug in Bun's React integration`);
}

// Client-side entry point expects an RSC payload. In development, let's fail
// loudly if this is somehow missing.
const initialPayload = document.getElementById("rsc_payload");
if (import.meta.env.DEV) {
  if (!initialPayload) assertionFailed("Missing #rsc_payload in HTML response");
}

// React takes in a ReadableStream with the payload.
let promise = createFromReadableStream(new Response(initialPayload!.innerText).body!);
initialPayload!.remove();

const Async = () => use(promise);
const root = hydrateRoot(document, <Async />, {
  // handle `onUncaughtError` here
});

export async function onServerSideReload() {
  const response = await fetch(location.href + '/index.rsc', {
    headers: {
      Accept: "text/x-component",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  promise = createFromReadableStream(response.body!);
  root.render(<Async />);
}

globalThis.onServerSideReload = onServerSideReload;
