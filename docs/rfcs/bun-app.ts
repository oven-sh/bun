import { FileSystemRouter, MatchedRoute, ServeOptions, Server } from "bun";

import { BuildManifest, BuildConfig, BundlerConfig } from "./bun-build-config";
import { BuildResult } from "./bun-build";

interface AppBuildConfig extends BuildConfig {
  serve?: Array<AppServeConfig>;
}

interface AppConfig {
  builds: { [k: string]: BundlerConfig };
  fetch: Array<AppServeConfig>;
}

type AppServeConfig =
  | {
      // serve static files
      mode: "static";
      // directory to serve from
      // e.g. "./public"
      dir: string;
      style: "static";
      // serve these files at a path
      // e.g. "/static"
      prefix?: string;
    }
  | {
      // serve the build outputs of a given build
      mode: "outputs";
      // must match a `name` specified in one of the `AppConfig`s
      // serve the build outputs of the build
      // with the given name
      build: "client";
      // serve these files at a path
      // e.g. "/static"
      prefix?: string;
    }
  | {
      mode: "handler";
      // request prefix, e.g. "/static"
      // if incoming Request  doesn't match prefix, no JS runs
      prefix?: string;
      // path to file that `export default`s a handler
      // this file is automatically added as an entrypoint in the build
      // e.g. ./serve.tsx

      handler: string;
      // default { manifest: true }
      context?: {
        // if true, expose build manifest on ctx.manifest
        // default true
        manifest: boolean;
        // check incoming request against this router
        // return MatchedResult on ctx.match
        match?: {
          dir: string;
          prefix: string;
          style: "nextjs";
        };
      };
      router?: FileSystemRouter;
    };

export declare class App {
  // you can a BuildConfig of an array of BuildConfigs
  // elements of the array can be undefined to make conditional builds easier
  /**
   *
   *
   * new App([
   *   { ... },
   *   condition ? {} : undefined
   * ])
   */
  constructor(options: AppBuildConfig | (AppBuildConfig | undefined)[]);
  // run a build and start the dev server
  serve(options: Partial<ServeOptions>): Promise<Server>;
  // run full build
  build(options?: {
    // all output directories are specified in `AppBuildConfig`
    // the `write` flag determines whether the build is written to disk
    // if write = true, the Blobs are BunFile
    // if write = false, the Blobs are just Blobs
    write?: boolean;
  }): Promise<BuildResult<Blob>>;

  handle(req: Request): Promise<Response | null>;
}

// the data that is passed as context to the Request handler
// - manifest: always provided
// - match: MatchedResult, only provided if `match` is specified in the `AppConfig`
interface HandlerContext {
  manifest: BuildManifest;
  match?: MatchedRoute;
}

/////////////////////////////////////
/////////////////////////////////////
/////////     EXAMPLES     //////////
/////////////////////////////////////
/////////////////////////////////////

// simple static file server
{
  const server = new App([
    {
      name: "static-server",
      outdir: "./.build/client",
      serve: [
        {
          mode: "static",
          dir: "./public",
          "style": "static",
        },
      ],
    },
  ]);

  // serves files from `./public` on port 3000
  await server.serve({
    port: 3000,
  });

  // copies files from ./public to `.build/client`
  await server.build();
}

// simple HTTP server
{
  /////////////////
  // handler.tsx //
  /////////////////
  // @ts-ignore
  export default (req: Request, ctx: BuildContext) => {
    return new Response("hello world");
  };

  /////////////
  // app.tsx //
  /////////////
  const app = new App([
    {
      name: "simple-http",
      target: "bun",
      entrypoints: [],
      outdir: "./.build/server",
      serve: [
        {
          mode: "handler",
          handler: "./handler.tsx", // automatically included as entrypoing
          prefix: "/api",
        },
      ],
      // bundler config..
    },
  ]);

  app.serve({
    port: 3000,
  });
}

// SSR react, pages directory
{
  /////////////////
  // handler.tsx //
  /////////////////
  // @ts-ignore
  import { renderToReadableStream } from "react-dom/server";

  // @ts-ignore
  export default (req: Request, context: HandlerContext) => {
    const { manifest } = context;
    const path = new URL(req.url).pathname;
    const builtComponent = manifest.inputs.get(".pages/" + path + ".tsx");

    const { default: Page } = await import(builtComponent);
    const stream = renderToReadableStream(builtComponent);
    return new Response(stream);
  };

  /////////////
  // app.tsx //
  /////////////
  const router = new Bun.FileSystemRouter({
    dir: "./app",
    style: "nextjs",
  });

  const app = new App([
    {
      name: "react-ssr",
      target: "bun",
      entrypoints: ["./handler.tsx", ...Object.values(router.routes)], // path to static directory
      outdir: "./.build/server",
      serve: [
        {
          mode: "handler",
          handler: "./handler.tsx",
        },
      ],
      // bundler config
    },
  ]);

  app.serve({
    port: 3000,
  });
}
