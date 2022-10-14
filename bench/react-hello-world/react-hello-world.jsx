// to run this:
//   bun --jsx-production react-hello-world.jsx

// This will become the official react-dom/server.bun build a little later
// It will be the default when you import from "react-dom/server"
// That will work via the "bun" package.json export condition (which bun already supports)
import { renderToReadableStream } from "../../test/bun.js/react-dom-server.bun";
const headers = {
  headers: {
    "Content-Type": "text/html",
  },
};

const App = () => (
  <html>
    <body>
      <h1>Hello World</h1>
      <p>This is an example.</p>
    </body>
  </html>
);

const port = Number(process.env.PORT || 3001);
Bun.serve({
  port,
  async fetch(req) {
    return new Response(await renderToReadableStream(<App />), headers);
  },
});

console.log(`Server running on\n  http://localhost:${port}`);
