// The browser half of the default framework of `bun bake`: hydrates the HTML that `server.tsx`
// rendered, with the same page, layouts, params and props.
import { onServerSideReload, route } from "bun:bake/client";
import { hydrateRoot } from "react-dom/client";

const { params, props, hasData } = JSON.parse(document.getElementById("__bun_bake_data")!.textContent!) as {
  params: Record<string, string | string[]>;
  props: object;
  hasData: boolean;
};

const [page, layouts] = await Promise.all([route!.page(), route!.layouts()]);
const Page = page.default;
let element = <Page params={params} {...props} />;
for (const layout of layouts) {
  const Layout = layout.default;
  element = <Layout params={params}>{element}</Layout>;
}
hydrateRoot(document.getElementById("root")!, element);

// An edit to the page or a layout comes here too, and Fast Refresh applies it in place. An edit
// that only the server sees can change the HTML or the props of the page: load it again.
onServerSideReload(({ clientCodeChanged }) => {
  if (!clientCodeChanged) location.reload();
});
