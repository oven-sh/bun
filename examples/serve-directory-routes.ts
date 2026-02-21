/**
 * Example: Serving Static Files with Directory Routes in Bun.serve()
 *
 * This example demonstrates how to serve static files from a directory
 * using the new directory routes feature in Bun.serve().
 *
 * To run this example:
 *   bun run examples/serve-directory-routes.ts
 *
 * Then visit:
 *   - http://localhost:3000/ (serves public/ directory)
 *   - http://localhost:3000/assets/... (serves static/assets/ directory)
 *   - http://localhost:3000/api/hello (dynamic route)
 */

import { serve } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// Create example directories and files for this demo
const setupExampleFiles = () => {
  const publicDir = join(import.meta.dir, "public");
  const assetsDir = join(import.meta.dir, "static", "assets");

  // Create directories
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
  }
  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
  }

  // Create example files
  writeFileSync(
    join(publicDir, "index.html"),
    `<!DOCTYPE html>
<html>
<head>
    <title>Directory Routes Example</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
    <h1>Welcome to Bun Directory Routes!</h1>
    <p>This page is served from the <code>public/</code> directory.</p>
    <img src="/assets/logo.svg" alt="Logo">
    <script src="/assets/app.js"></script>
</body>
</html>`,
  );

  writeFileSync(
    join(assetsDir, "style.css"),
    `body {
  font-family: system-ui, sans-serif;
  max-width: 800px;
  margin: 40px auto;
  padding: 20px;
  line-height: 1.6;
}

h1 {
  color: #333;
  border-bottom: 2px solid #fbf0df;
  padding-bottom: 10px;
}`,
  );

  writeFileSync(
    join(assetsDir, "app.js"),
    `console.log("Hello from directory routes!");
document.addEventListener("DOMContentLoaded", () => {
  console.log("Page loaded successfully");
});`,
  );

  writeFileSync(
    join(assetsDir, "logo.svg"),
    `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" fill="#fbf0df"/>
  <text x="50" y="55" font-size="40" text-anchor="middle" fill="#000">🍞</text>
</svg>`,
  );

  console.log("✓ Example files created in public/ and static/assets/");
};

// Set up the example files
setupExampleFiles();

// Start the server
const server = serve({
  port: 3000,

  routes: {
    // Serve files from the public directory at the root
    // This will serve:
    // - /index.html from public/index.html
    // - /favicon.ico from public/favicon.ico (if it exists)
    // - etc.
    "/*": {
      dir: join(import.meta.dir, "public"),
    },

    // Serve assets from a separate directory
    // This will serve:
    // - /assets/style.css from static/assets/style.css
    // - /assets/app.js from static/assets/app.js
    // - etc.
    "/assets/*": {
      dir: join(import.meta.dir, "static", "assets"),
    },

    // Mix directory routes with dynamic routes
    "/api/hello": {
      GET() {
        return Response.json({
          message: "Hello from a dynamic route!",
          timestamp: new Date().toISOString(),
        });
      },
    },
  },

  // Fallback handler for requests that don't match any route or file
  fetch(req) {
    console.log(`[404] ${req.method} ${req.url}`);
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
    <title>404 Not Found</title>
</head>
<body>
    <h1>404 - Page Not Found</h1>
    <p>The requested URL <code>${new URL(req.url).pathname}</code> was not found.</p>
    <a href="/">Go back home</a>
</body>
</html>`,
      {
        status: 404,
        headers: {
          "Content-Type": "text/html",
        },
      },
    );
  },
});

console.log(`
🚀 Server running at ${server.url}

Try these URLs:
  ${server.url}                    → public/index.html
  ${server.url}assets/style.css    → static/assets/style.css
  ${server.url}assets/app.js       → static/assets/app.js
  ${server.url}assets/logo.svg     → static/assets/logo.svg
  ${server.url}api/hello           → Dynamic API route
  ${server.url}nonexistent         → 404 fallback handler

Press Ctrl+C to stop the server
`);
