// The browser half of the default framework of `bun bake`: hydrates the HTML that `server.tsx`
// rendered, with the same page, layouts and params.
import { onServerSideReload, route } from "bun:bake/client";
import { hydrateRoot } from "react-dom/client";

const params: Record<string, string | string[]> =
  JSON.parse(document.getElementById("__bun_bake_params")?.textContent || "null") ?? {};

const [page, layouts] = await Promise.all([route!.page(), route!.layouts()]);
const Page = page.default;
let element = <Page params={params} />;
for (const layout of layouts) {
  const Layout = layout.default;
  element = <Layout params={params}>{element}</Layout>;
}
hydrateRoot(document.getElementById("root")!, element);

// The page and layouts also run here, so Fast Refresh updates them in place. The server's copy of
// the same edit needs no reload of the page.
onServerSideReload(() => {});
