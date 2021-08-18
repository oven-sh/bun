import NextPageLoader from "next/dist/client/page-loader";

export default class PageLoader extends NextPageLoader {
  public routeLoader: RouteLoader;

  constructor(_, __, pages) {
    super(_, __);

    this.pages = pages;
  }

  getPageList() {
    return Object.keys(this.pages);
  }

  loadPage(route: string): Promise<GoodPageCache> {
    return this.routeLoader.loadRoute(route).then((res) => {
      if ("component" in res) {
        return {
          page: res.component,
          mod: res.exports,
          styleSheets: res.styles.map((o) => ({
            href: o.href,
            text: o.content,
          })),
        };
      }
      throw res.error;
    });
  }

  // not used in development!
  prefetch(route: string): Promise<void> {
    return this.routeLoader.prefetch(route);
  }
}
