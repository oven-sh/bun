import type { ReactNode, SetStateAction } from "react";
import { createFromReadableStream } from "../../vendor/react-server-dom-bun/client.browser.js";
import { store, useStore, type Store } from "./store.ts";

export type NonNullishReactNode = Exclude<ReactNode, null | undefined>;
export type RenderableRscPayload = Promise<NonNullishReactNode> | NonNullishReactNode;

const encoder = new TextEncoder();

function enqueueChunks(
  controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>,
  ...chunks: (string | Uint8Array<ArrayBuffer>)[]
) {
  for (let chunk of chunks) {
    if (typeof chunk === "string") {
      chunk = encoder.encode(chunk);
    }

    controller.enqueue(chunk);
  }
}

export interface AppState {
  /**
   * The renderable RSC payload
   */
  rsc: RenderableRscPayload;

  /**
   * A controller that aborts on the first render
   */
  abortOnRender?: AbortController | undefined;
}

// The initial RSC payload is put into inline <script> tags that follow the pattern
// `(self.__bun_f ??= []).push(chunk)`, which is converted into a ReadableStream
// here for React hydration. Since inline scripts are executed immediately, and
// this file is loaded asynchronously, the `__bun_f` becomes a clever way to
// stream the arbitrary data while HTML is loading. In a static build, this is
// setup as an array with one string.
const initialRscPayload: Promise<NonNullishReactNode> =
  typeof document === "undefined"
    ? Promise.resolve(false)
    : createFromReadableStream(
        new ReadableStream<NonNullishReactNode>({
          start(controller) {
            const bunF = (self.__bun_f ??= []);
            const originalPush = bunF.push;

            bunF.push = function (this: typeof bunF, ...chunks: (string | Uint8Array<ArrayBuffer>)[]) {
              enqueueChunks(controller, ...chunks);
              return originalPush.apply(this, chunks);
            }.bind(bunF);

            bunF.forEach(chunk => enqueueChunks(controller, chunk));

            if (document.readyState === "loading") {
              document.addEventListener(
                "DOMContentLoaded",
                () => {
                  controller.close();
                },
                { once: true },
              );
            } else {
              controller.close();
            }
          },
        }),
      );

declare global {
  interface Window {
    __bun_f: Array<string | Uint8Array<ArrayBuffer>>;
  }
}

const appStore: Store<AppState> = store<AppState>({
  rsc: initialRscPayload,
});

export function setAppState(element: SetStateAction<AppState>): void {
  appStore.write(element);
}

export function useAppState(): AppState {
  return useStore(appStore);
}

export function getAppState(): AppState {
  return appStore.read();
}

export function initialRscPayloadThen(then: (rsc: NonNullishReactNode) => void): void {
  void initialRscPayload.then(then);
}
