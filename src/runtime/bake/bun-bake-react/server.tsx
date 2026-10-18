// The default framework of `bun bake` for `.tsx` and `.jsx` pages, with the project's own React.
// Bake bundles it into the server graph from the project root, so `react` resolves from the project.
// `react-dom/server.browser` has `renderToReadableStream` in React 18 and 19.
import { renderToReadableStream } from "react-dom/server.browser";

type RouteMetadata = {
  pageModule: { default?: (props: any) => any };
  layouts: ReadonlyArray<{ default?: (props: any) => any }>;
  params: null | Record<string, string | string[]>;
  modules: ReadonlyArray<string>;
  modulepreload: ReadonlyArray<string>;
  styles: ReadonlyArray<string>;
};

export async function render(request: Request, meta: RouteMetadata): Promise<Response> {
  const Page = meta.pageModule.default;
  // A function, or what memo(), forwardRef() and lazy() return: React checks the type.
  if (Page == null) {
    throw new TypeError("A page must have a default export: the React component of the page.");
  }
  const params = meta.params ?? {};
  let element = <Page params={params} />;
  // The first layout is the inner-most.
  for (const layout of meta.layouts) {
    const Layout = layout.default;
    if (Layout == null) {
      throw new TypeError("A layout must have a default export: the React component of the layout.");
    }
    element = <Layout params={params}>{element}</Layout>;
  }

  const stream = await renderToReadableStream(
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {meta.styles.map(href => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {meta.modulepreload.map(href => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {/* `client.tsx` reads the params from here, to hydrate the same tree. In <head>, so it is
            there before the browser bundle runs. */}
        <script
          id="__bun_bake_params"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(params).replaceAll("<", "\\u003c") }}
        />
      </head>
      <body>
        <div id="root">{element}</div>
      </body>
    </html>,
    // React writes these with the shell, so hydration starts before the slowest Suspense boundary.
    { signal: request.signal, bootstrapModules: [...meta.modules] },
  );
  return new Response(stream, { headers: { "content-type": "text/html; charset=utf-8" } });
}
