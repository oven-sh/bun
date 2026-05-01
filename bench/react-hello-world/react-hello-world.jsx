// to run this:
//  NODE_ENV=production bun react-hello-world.jsx

// Make sure you're using react-dom@18.3.0 or later.
// Currently that is available at react-dom@next (which is installed in this repository)
import { renderToReadableStream } from "react-dom/server";
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
