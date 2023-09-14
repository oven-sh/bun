---
name: Server-side render (SSR) a React component
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

React `18.3` and later includes an [SSR optimization](https://github.com/facebook/react/pull/25597) that takes advantage of Bun's "direct" `ReadableStream` implementation.
