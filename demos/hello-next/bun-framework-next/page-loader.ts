import NextPageLoader from "next/dist/client/page-loader";
import getAssetPathFromRoute from "next/dist/shared/lib/router/utils/get-asset-path-from-route";
import createRouteLoader from "./route-loader";

export default class PageLoader extends NextPageLoader {
  public routeLoader: RouteLoader;

  constructor(_, __, pages) {
    super(_, __);

    // TODO: assetPrefix?
    this.routeLoader = createRouteLoader("");
    this.pages = pages;
  }

  getPageList() {
    return Object.keys(this.pages);
  }

  async loadPage(route: string): Promise<GoodPageCache> {
    try {
      const assets =
        globalThis.__NEXT_DATA__.pages[route] ||
        globalThis.__NEXT_DATA__.pages[getAssetPathFromRoute(route)];

      var src;
      console.log(getAssetPathFromRoute(route), assets);
      for (let asset of assets) {
        if (!asset.endsWith(".css")) {
          src = asset;
          break;
        }
      }

      console.assert(src, "Invalid or unknown route passed to loadPage");
      const res = await import(src);
      console.log({ res });

      return {
        page: res.default,
        mod: res,
        __N_SSG: false,
        __N_SSP: false,
      };
    } catch (err) {}

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
