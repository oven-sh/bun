Bun supports `.jsx` and `.tsx` files out of the box. Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution.

```ts#react.tsx
function Component(props: {message: string}) {
  return (
    <body>
      <h1 style={{fontSize: 'red'}}>{props.message}</h1>
    </body>
  );
}

console.log(<Component />);
```

Bun implements special logging for JSX to make debugging easier.

```bash
$ bun run react.tsx
<Component message="Hello world!" />
```

To server-side render (SSR) React in an [HTTP server](/docs/api/http):

```tsx#ssr.tsx
import {renderToReadableStream} from 'react-dom/server';

function Component(props: {message: string}) {
  return (
    <body>
      <h1 style={{fontSize: 'red'}}>{props.message}</h1>
    </body>
  );
}

Bun.serve({
  port: 4000,
  async fetch() {
    const stream = await renderToReadableStream(
      <Component message="Hello from server!" />
    );
    return new Response(stream, {
      headers: {'Content-Type': 'text/html'},
    });
  },
});
```
