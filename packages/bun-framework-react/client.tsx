import { onServerSideReload } from "bun:app/client";
import { hydrateRoot } from "react-dom/client";
import { initialRscPayloadThen } from "./src/client/app.ts";
import { router } from "./src/client/constants.ts";
import { Root } from "./src/client/root.tsx";

hydrateRoot(document, <Root />, {
  onUncaughtError(e) {
    console.error(e);
  },
});

const firstPageId = Date.now();
{
  history.replaceState(firstPageId, "", location.href);
  initialRscPayloadThen(result => {
    if (router.hasNavigatedSinceDOMContentLoaded()) return;

    // Collect the list of CSS files that were added from SSR
    const links = document.querySelectorAll<HTMLLinkElement>("link[data-bake-ssr]");
    router.css.clear();

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!link) continue;
      const href = new URL(link.href).pathname;
      router.css.push(href);

      // Hack: cannot add this to `cssFiles` because React owns the element, and
      // it will be removed when any navigation is performed.
    }

    router.setCachedPage(firstPageId, {
      css: [...router.css.getList()],
      element: result,
    });
  });

  if (document.startViewTransition !== undefined) {
    // View transitions are used by navigations to ensure that the page rerender
    // all happens in one operation. Additionally, developers may animate
    // different elements. The default fade animation is disabled so that the
    // out-of-the-box experience feels like there are no view transitions.
    // This is done client-side because a React error will unmount all elements.
    const sheet = new CSSStyleSheet();
    document.adoptedStyleSheets.push(sheet);
    sheet.replaceSync(":where(*)::view-transition-group(root){animation:none}");
  }
}

window.addEventListener("popstate", async event => {
  const state = typeof event.state === "number" ? event.state : undefined;
  await router.navigate(location.href, state);
});

if (import.meta.env.DEV) {
  // Frameworks can call `onServerSideReload` to hook into server-side hot
  // module reloading.
  onServerSideReload(async () => {
    const newId = Date.now();
    history.replaceState(newId, "", location.href);
    await router.navigate(location.href, newId);
  });
}
