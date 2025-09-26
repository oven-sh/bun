import { flushSync } from "react-dom";
import { createFromReadableStream } from "react-server-dom-esm/client.browser";
import { getAppState, setAppState, type AppState, type NonNullishReactNode } from "./app.ts";
import { BakeCSSManager } from "./css.ts";

export interface CachedPage {
  css: string[];
  element: NonNullishReactNode;
}

export class Router {
  private lastNavigationId: number = 0;
  private lastNavigationController: AbortController | null = null;

  // Keep a cache of page objects to avoid re-fetching a page when pressing the
  // back button. The cache is indexed by the date it was created.
  private readonly cachedPages = new Map<number, CachedPage>();

  // Track in-flight RSC fetches keyed by the resolved request URL so that
  // navigations can adopt an existing stream instead of issuing a duplicate
  // request.
  private readonly inflight = new Map<
    string,
    { controller: AbortController; css: string[]; model: Promise<NonNullishReactNode> }
  >();

  public readonly css: BakeCSSManager = new BakeCSSManager();

  public hasNavigatedSinceDOMContentLoaded(): boolean {
    return this.lastNavigationId !== 0;
  }

  public setCachedPage(id: number, page: CachedPage): void {
    this.cachedPages.set(id, page);
  }

  /** Start fetching an RSC payload for a given href without committing UI. */
  public async prefetch(href: string): Promise<void> {
    const requestUrl = this.computeRequestUrl(href);

    if (this.inflight.has(requestUrl)) return;

    const controller = new AbortController();
    const signal = controller.signal;

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        headers: { Accept: "text/x-component" },
        signal,
      });
      if (!response.ok) return;
    } catch {
      return;
    }

    // Parse CSS list without mutating the active CSS set, and keep the stream
    // intact for React consumption.
    const { stream, list } = await this.css.readCssMetadataForPrefetch(response.body!);

    const model = createFromReadableStream(stream) as Promise<NonNullishReactNode>;

    this.inflight.set(requestUrl, { controller, css: list, model });

    // Cleanup when the model settles to avoid leaks (if we never navigate).
    void model.finally(() => {
      // Do not delete if it's currently adopted by a navigation (i.e. lastNavigationController === controller)
      if (this.inflight.get(requestUrl)?.controller === controller) return;
      this.inflight.delete(requestUrl);
    });
  }

  private computeRequestUrl(href: string): string {
    const url = new URL(href, location.href);
    url.hash = "";
    if (import.meta.env.STATIC) {
      // For static, fetch the .rsc artifact
      const path = url.pathname.replace(/\/(?:index)?$/, "") + "/index.rsc";
      return new URL(path + url.search, location.origin).toString();
    }
    return url.toString();
  }

  async navigate(href: string, cacheId: number | undefined): Promise<void> {
    const thisNavigationId = ++this.lastNavigationId;
    const olderController = this.lastNavigationController;

    // If there is an in-flight prefetch for this href, adopt it.
    const requestUrl = this.computeRequestUrl(href);
    const adopted = this.inflight.get(requestUrl);
    this.lastNavigationController = adopted?.controller ?? new AbortController();

    const signal = this.lastNavigationController.signal;

    signal.addEventListener(
      "abort",
      () => {
        olderController?.abort();
      },
      { once: true },
    );

    // If the page is cached, use the cached promise instead of fetching it again.
    const cached = cacheId !== undefined && this.cachedPages.get(cacheId);
    if (cached) {
      await this.css.set(cached.css);

      const state: AppState = {
        rsc: cached.element,
      };

      if (olderController?.signal.aborted === false) {
        state.abortOnRender = olderController;
      }

      setAppState(state);
      return;
    }

    let p: NonNullishReactNode;
    if (adopted) {
      // Adopt prefetch: set CSS list and await the same model.
      await this.css.set(adopted.css);
      const cssWaitPromise = this.css.ensureCssIsReady();
      {
        const result = await adopted.model;
        if (result == null) {
          throw new Error("RSC payload was empty");
        }
        p = result as NonNullishReactNode;
      }
      if (thisNavigationId !== this.lastNavigationId) return;
      if (cssWaitPromise) {
        await cssWaitPromise;
        if (thisNavigationId !== this.lastNavigationId) return;
      }
      // Remove from inflight now that it's adopted
      this.inflight.delete(requestUrl);
    } else {
      let response: Response;
      try {
        response = await fetch(requestUrl, {
          headers: { Accept: "text/x-component" },
          signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${href}: ${response.status} ${response.statusText}`);
        }
      } catch (err) {
        if (thisNavigationId === this.lastNavigationId) {
          // Bail out to browser navigation if this fetch fails.
          console.error(err);
          location.href = href;
        }
        return;
      }

      if (thisNavigationId !== this.lastNavigationId) return;
      let stream = response.body!;
      stream = await this.css.readCssMetadata(stream);
      if (thisNavigationId !== this.lastNavigationId) return;

      const cssWaitPromise = this.css.ensureCssIsReady();
      {
        const model = createFromReadableStream(stream) as Promise<NonNullishReactNode | undefined | null>;
        const result = await model;
        if (result == null) {
          throw new Error("RSC payload was empty");
        }
        p = result as NonNullishReactNode;
      }
      if (thisNavigationId !== this.lastNavigationId) return;
      if (cssWaitPromise) {
        await cssWaitPromise;
        if (thisNavigationId !== this.lastNavigationId) return;
      }
    }

    // Save this promise so that pressing the back button in the browser navigates
    // to the same instance of the old page, instead of re-fetching it.
    if (cacheId !== undefined) {
      this.cachedPages.set(cacheId, {
        css: [...this.css.getList()],
        element: p,
      });
    }

    // Defer aborting a previous request until VERY late. If a previous stream is
    // aborted while rendering, it will cancel the render, resulting in a flash of
    // a blank page.
    if (olderController?.signal.aborted === false) {
      getAppState().abortOnRender = olderController;
    }

    // Tell react about the new page promise
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        flushSync(() => {
          if (thisNavigationId === this.lastNavigationId) {
            setAppState(old => ({
              rsc: p,
              abortOnRender: olderController ?? old.abortOnRender,
            }));
          }
        });
      });
    } else {
      setAppState(old => ({
        rsc: p,
        abortOnRender: olderController ?? old.abortOnRender,
      }));
    }
  }
}
