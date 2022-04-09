import NextPageLoader, {
  GoodPageCache as NextGoodPageCache,
} from "next/dist/client/page-loader";
import getAssetPathFromRoute from "next/dist/shared/lib/router/utils/get-asset-path-from-route";

export function insertStyleSheet(url: string, isFallback: boolean = false) {
  if (document.querySelector(`link[href="${url}"]`)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link: HTMLLinkElement = document.createElement("link");
    link.rel = "stylesheet";

    // marking this resolve as void seems to break other things
    link.onload = resolve;
    link.onerror = reject;

    link.href = url;

    if (isFallback) {
      link.setAttribute("data-href", url);
    }

    document.head.appendChild(link);
  });
}

interface GoodPageCache extends NextGoodPageCache {
  __N_SSG: boolean;
  __N_SSP: boolean;
}

export default class PageLoader extends NextPageLoader {
  constructor(_, __, pages) {
    super(_, __);

    // TODO: assetPrefix?

    // Rewrite the pages object to omit the entry script
    // At this point, the entry point has been loaded so we don't want to do that again.
    for (let name in pages) {
      for (let i = 0; i < pages[name].length; i += 1) {
        const lastDot = pages[name][i].lastIndexOf(".");
        if (lastDot == -1) continue;
        if (
          pages[name][i].substring(lastDot - ".entry".length, lastDot) !==
          ".entry"
        )
          continue;

        pages[name][i] =
          pages[name][i].substring(0, lastDot - ".entry".length) +
          pages[name][i].substring(lastDot);
      }
    }

    this.pages = pages;
    this.pageList = Object.keys(this.pages);
  }

  pageList: string[];
  pages: Record<string, string[]>;

  getPageList() {
    return this.pageList;
  }

  async getMiddlewareList() {
    return [];
  }

  cssQueue = [];

  onImportCSS = (event) => {
    this.cssQueue.push(
      insertStyleSheet(event.detail).then(
        () => {},
        () => {}
      )
    );
  };

  prefetch() {
    return Promise.resolve();
  }

  async loadPage(route: string): Promise<GoodPageCache> {
    const assets =
      this.pages[route] || this.pages[getAssetPathFromRoute(route)];

    var src;
    for (let asset of assets) {
      if (!asset.endsWith(".css")) {
        src = asset;
        break;
      }
    }
    console.assert(src, "Invalid or unknown route passed to loadPage");

    if ("__BunClearBuildFailure" in globalThis) {
      globalThis.__BunClearBuildFailure();
    }

    document.removeEventListener("onimportcss", this.onImportCSS);
    this.cssQueue.length = 0;
    document.addEventListener("onimportcss", this.onImportCSS, {
      passive: true,
    });

    try {
      const res = await import(src);

      if (this.cssQueue.length > 0) {
        await Promise.all(this.cssQueue);
        this.cssQueue.length = 0;
      }

      document.removeEventListener("onimportcss", this.onImportCSS);

      if (this.cssQueue.length > 0) {
        await Promise.all(this.cssQueue);

        this.cssQueue.length = 0;
      }

      return {
        page: res.default,
        mod: res,
        styleSheets: [],
        __N_SSG: false,
        __N_SSP: false,
      };
    } catch (exception) {
      console.error({ exception });
    }
  }
}
