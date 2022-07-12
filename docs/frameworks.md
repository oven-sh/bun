### Frameworks

> **Warning**
> This will soon have breaking changes. It was designed when Bun was mostly a dev server and not a JavaScript runtime.

Frameworks preconfigure bun to enable developers to use bun with their existing tooling.

Frameworks are configured via the `framework` object in the `package.json` of the framework (not in the application’s `package.json`):

Here is an example:

```json
{
  "name": "bun-framework-next",
  "version": "0.0.0-18",
  "description": "",
  "framework": {
    "displayName": "Next.js",
    "static": "public",
    "assetPrefix": "_next/",
    "router": {
      "dir": ["pages", "src/pages"],
      "extensions": [".js", ".ts", ".tsx", ".jsx"]
    },
    "css": "onimportcss",
    "development": {
      "client": "client.development.tsx",
      "fallback": "fallback.development.tsx",
      "server": "server.development.tsx",
      "css": "onimportcss",
      "define": {
        "client": {
          ".env": "NEXT_PUBLIC_",
          "defaults": {
            "process.env.__NEXT_TRAILING_SLASH": "false",
            "process.env.NODE_ENV": "\"development\"",
            "process.env.__NEXT_ROUTER_BASEPATH": "''",
            "process.env.__NEXT_SCROLL_RESTORATION": "false",
            "process.env.__NEXT_I18N_SUPPORT": "false",
            "process.env.__NEXT_HAS_REWRITES": "false",
            "process.env.__NEXT_ANALYTICS_ID": "null",
            "process.env.__NEXT_OPTIMIZE_CSS": "false",
            "process.env.__NEXT_CROSS_ORIGIN": "''",
            "process.env.__NEXT_STRICT_MODE": "false",
            "process.env.__NEXT_IMAGE_OPTS": "null"
          }
        },
        "server": {
          ".env": "NEXT_",
          "defaults": {
            "process.env.__NEXT_TRAILING_SLASH": "false",
            "process.env.__NEXT_OPTIMIZE_FONTS": "false",
            "process.env.NODE_ENV": "\"development\"",
            "process.env.__NEXT_OPTIMIZE_IMAGES": "false",
            "process.env.__NEXT_OPTIMIZE_CSS": "false",
            "process.env.__NEXT_ROUTER_BASEPATH": "''",
            "process.env.__NEXT_SCROLL_RESTORATION": "false",
            "process.env.__NEXT_I18N_SUPPORT": "false",
            "process.env.__NEXT_HAS_REWRITES": "false",
            "process.env.__NEXT_ANALYTICS_ID": "null",
            "process.env.__NEXT_CROSS_ORIGIN": "''",
            "process.env.__NEXT_STRICT_MODE": "false",
            "process.env.__NEXT_IMAGE_OPTS": "null",
            "global": "globalThis",
            "window": "undefined"
          }
        }
      }
    }
  }
}
```

Here are type definitions:

```ts
type Framework = Environment & {
  // This changes what’s printed in the console on load
  displayName?: string;

  // This allows a prefix to be added (and ignored) to requests.
  // Useful for integrating an existing framework that expects internal routes to have a prefix
  // e.g. "_next"
  assetPrefix?: string;

  development?: Environment;
  production?: Environment;

  // The directory used for serving unmodified assets like fonts and images
  // Defaults to "public" if exists, else "static", else disabled.
  static?: string;

  // "onimportcss" disables the automatic "onimportcss" feature
  // If the framework does routing, you may want to handle CSS manually
  // "facade" removes CSS imports from JavaScript files,
  //    and replaces an imported object with a proxy that mimics CSS module support without doing any class renaming.
  css?: "onimportcss" | "facade";

  // bun’s filesystem router
  router?: Router;
};

type Define = {
  // By passing ".env", bun will automatically load .env.local, .env.development, and .env if exists in the project root
  //    (in addition to the processes’ environment variables)
  // When "*", all environment variables will be automatically injected into the JavaScript loader
  // When a string like "NEXT_PUBLIC_", only environment variables starting with that prefix will be injected

  ".env": string | "*";

  // These environment variables will be injected into the JavaScript loader
  // These are the equivalent of Webpack’s resolve.alias and esbuild’s --define.
  // Values are parsed as JSON, so they must be valid JSON. The only exception is '' is a valid string, to simplify writing stringified JSON in JSON.
  // If not set, `process.env.NODE_ENV` will be transformed into "development".
  defaults: Record<string, string>;
};

type Environment = {
  // This is a wrapper for the client-side entry point for a route.
  // This allows frameworks to run initialization code on pages.
  client: string;
  // This is a wrapper for the server-side entry point for a route.
  // This allows frameworks to run initialization code on pages.
  server: string;
  // This runs when "server" code fails to load due to an exception.
  fallback: string;

  // This is how environment variables and .env is configured.
  define?: Define;
};

// bun’s filesystem router
// Currently, bun supports pages by either an absolute match or a parameter match.
// pages/index.tsx will be executed on navigation to "/" and "/index"
// pages/posts/[id].tsx will be executed on navigation to "/posts/123"
// Routes & parameters are automatically passed to `fallback` and `server`.
type Router = {
  // This determines the folder to look for pages
  dir: string[];

  // These are the allowed file extensions for pages.
  extensions?: string[];
};
```

To use a framework, you pass `bun bun --use package-name`.

Your framework’s `package.json` `name` should start with `bun-framework-`. This is so that people can type something like `bun bun --use next` and it will check `bun-framework-next` first. This is similar to how Babel plugins tend to start with `babel-plugin-`.

For developing frameworks, you can also do `bun bun --use ./relative-path-to-framework`.

If you’re interested in adding a framework integration, please reach out. There’s a lot here and it’s not entirely documented yet.
