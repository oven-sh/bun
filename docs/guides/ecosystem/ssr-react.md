---
name: Server-side render (SSR) a React component
---

To get started, install the canary version of `react` & `react-dom`:

```sh
# Any package manager can be used
$ bun add react@canary react-dom@canary
```

---

To render a React component to an HTML stream server-side (SSR):

```tsx
import { renderToReadableStream } from "react-dom/server";

function Component(props: { message: string }) {
  return (
    <body>
      <h1>{props.message}</h1>
    </body>
  );
}

const stream = await renderToReadableStream(
  <Component message="Hello from server!" />,
);
```

---

Combining this with `Bun.serve()`, we get a simple SSR HTTP server:

```tsx
Bun.serve({
  async fetch() {
    const stream = await renderToReadableStream(
      <Component message="Hello from server!" />,
    );
    return new Response(stream, {
      headers: { "Content-Type": "text/html" },
    });
  },
});
```

---

React `19` and later includes an [SSR optimization](https://github.com/facebook/react/pull/25597) that takes advantage of Bun's "direct" `ReadableStream` implementation. If you run into an error like `export named 'renderToReadableStream' not found`, please make sure to install the canary version of `react` & `react-dom`, or import from `react-dom/server.browser` instead of `react-dom/server`. See [facebook/react#28941](https://github.com/facebook/react/issues/28941) for more information.
