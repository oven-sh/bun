import { renderNextJSPage } from "bun-nextjs/server";

addEventListener("fetch", (event: FetchEvent) => {
  const AppComponent = module.requireFirst(
    "pages/_app",
    "bun-nextjs/pages/_app"
  );
  const Document = module.requireFirst(
    "pages/_document",
    "bun-nextjs/pages/_document"
  );
});

// typescript isolated modules
export {};
