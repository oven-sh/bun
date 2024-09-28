/// <reference lib="dom" />
// @ts-ignore
import { type FC, type ReactNode, use } from "react";
// @ts-ignore
import { hydrateRoot } from "react-dom/client";
// @ts-ignore
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";

function main(rscPayload: string) {
  const promise = createFromReadableStream<ReactNode>(
    new Response(rscPayload).body,
  );

  const Async: FC = () => use(promise);
  // @ts-ignore
  hydrateRoot(document, <Async />);
}

main(document.getElementById("rsc_payload")!.textContent!);
