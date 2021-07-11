import { renderNextJSPage } from "speedy-nextjs/server";

addEventListener("fetch", (event: FetchEvent) => {
  const AppComponent = module.requireFirst(
    "pages/_app",
    "speedy-nextjs/pages/_app"
  );
  const Document = module.requireFirst(
    "pages/_document",
    "speedy-nextjs/pages/_document"
  );
});

// typescript isolated modules
export {};
