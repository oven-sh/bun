import { bench, group, run } from "mitata";
import { renderToReadableStream } from "react-dom/cjs/react-dom-server.browser.production.min";
import { renderToReadableStream as renderToReadableStreamBun } from "../test/bun.js/reactdom-bun";

const App = () => (
  <div>
    <h1>Hello, world!</h1>
    <p>
      This is a React component This is a React component This is a React
      component This is a React component.
    </p>
    <p>
      This is a React component This is a React component This is a React
      component This is a React component.
    </p>
    <p>
      This is a React component This is a React component This is a React
      component This is a React component.
    </p>
    <p>
      This is a React component This is a React component This is a React
      component This is a React component.
    </p>
    <p>
      This is a React component This is a React component This is a React
      component This is a React component.
    </p>
  </div>
);

group("new Response(stream).text()", () => {
  bench(
    "react-dom/server.browser",
    async () => await new Response(await renderToReadableStream(<App />)).text()
  );
  bench(
    "react-dom/server.bun",
    async () =>
      await new Response(await renderToReadableStreamBun(<App />)).text()
  );
});

group("new Response(stream).arrayBuffer()", () => {
  bench(
    "react-dom/server.browser",
    async () =>
      await new Response(await renderToReadableStream(<App />)).arrayBuffer()
  );
  bench(
    "react-dom/server.bun",
    async () =>
      await new Response(await renderToReadableStreamBun(<App />)).arrayBuffer()
  );
});

group("new Response(stream).blob()", () => {
  bench(
    "react-dom/server.browser",
    async () => await new Response(await renderToReadableStream(<App />)).blob()
  );
  bench(
    "react-dom/server.bun",
    async () =>
      await new Response(await renderToReadableStreamBun(<App />)).blob()
  );
});

await run();
