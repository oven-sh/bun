import NextPageLoader from "next/dist/client/page-loader";
import getAssetPathFromRoute from "next/dist/shared/lib/router/utils/get-asset-path-from-route";
import createRouteLoader from "./route-loader";

function insertStyleSheet(url: string) {
  if (document.querySelector(`link[href="${url}"]`)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;

    link.onload = () => void resolve();

    link.onerror = () => void reject();
    document.head.appendChild(link);
  });
}

export default class PageLoader extends NextPageLoader {
  public routeLoader: RouteLoader;

  constructor(_, __, pages) {
    super(_, __);

    // TODO: assetPrefix?
    this.routeLoader = createRouteLoader("");

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

  cssQueue = [];

  onImportCSS = (event) => {
    this.cssQueue.push(insertStyleSheet(event.detail).then(() => void 0));
  };
  async loadPage(route: string): Promise<GoodPageCache> {
    const assets =
      this.pages[route] || this.pages[getAssetPathFromRoute(route)];

    var src;
    console.log(getAssetPathFromRoute(route), assets);
    for (let asset of assets) {
      if (!asset.endsWith(".css")) {
        src = asset;
        break;
      }
    }
    console.assert(src, "Invalid or unknown route passed to loadPage");

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
      return {
        page: res.default,
        mod: res,
        styleSheets: [],
        __N_SSG: false,
        __N_SSP: false,
      };

      debugger;
    } catch (exception) {
      debugger;
    }

    // return this.routeLoader.loadRoute(route).then((res) => {
    //   debugger;
    //   if ("component" in res) {
    //     return {
    //       page: res.component,
    //       mod: res.exports,
    //       styleSheets: res.styles.map((o) => ({
    //         href: o.href,
    //         text: o.content,
    //       })),
    //     };
    //   }
    //   throw res.error;
    // });
  }

  // not used in development!
  prefetch(route: string): Promise<void> {
    return this.routeLoader.prefetch(route);
  }
}
