import { flushSync } from "react-dom";
import { createFromReadableStream } from "react-server-dom-bun/client.browser";
import { getAppState, setAppState, type AppState, type NonNullishReactNode } from "./app.ts";
import { BakeCSSManager } from "./css.ts";

export namespace Router {
  export interface CachedPage {
    css: string[];
    element: NonNullishReactNode;
  }
}

export class Router {
  private lastNavigationId: number = 0;
  private lastNavigationController: AbortController | null = null;

  // Keep a cache of page objects to avoid re-fetching a page when pressing the
  // back button. The cache is indexed by the date it was created.
  private readonly cachedPages = new Map<number, Router.CachedPage>();

  public readonly css: BakeCSSManager = new BakeCSSManager();

  public hasNavigatedSinceDOMContentLoaded(): boolean {
    return this.lastNavigationId !== 0;
  }

  public setCachedPage(id: number, page: Router.CachedPage): void {
    this.cachedPages.set(id, page);
  }

  async navigate(href: string, cacheId?: number): Promise<void> {
    const thisNavigationId = ++this.lastNavigationId;
    const olderController = this.lastNavigationController;

    this.lastNavigationController = new AbortController();

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

    let response: Response;
    try {
      // When using static builds, it isn't possible for the server to reliably
      // branch on the `Accept` header. Instead, a static build creates a `.rsc`
      // file that can be fetched. `import.meta.env.STATIC` is inlined by Bake.

      const url = import.meta.env.STATIC ? `${href.replace(/\/(?:index)?$/, "")}/index.rsc` : href;

      response = await fetch(url, {
        headers: {
          Accept: "text/x-component",
        },
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

    // If the navigation id has changed, this fetch is no longer relevant.
    if (thisNavigationId !== this.lastNavigationId) return;
    let stream = response.body!;

    // Read the css metadata at the start before handing it to react.
    stream = await this.css.readCssMetadata(stream);
    if (thisNavigationId !== this.lastNavigationId) return;

    const cssWaitPromise = this.css.ensureCssIsReady();

    const p = await createFromReadableStream(stream);
    if (thisNavigationId !== this.lastNavigationId) return;

    if (cssWaitPromise) {
      await cssWaitPromise;
      if (thisNavigationId !== this.lastNavigationId) return;
    }

    // Save this promise so that pressing the back button in the browser navigates
    // to the same instance of the old page, instead of re-fetching it.
    if (cacheId) {
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
    if (document.startViewTransition as unknown) {
      document.startViewTransition(() => {
        flushSync(() => {
          if (thisNavigationId === this.lastNavigationId)
            setAppState({
              rsc: p,
              abortOnRender: olderController ?? undefined,
            });
        });
      });
    } else {
      setAppState({
        rsc: p,
        abortOnRender: olderController ?? undefined,
      });
    }
  }
}
