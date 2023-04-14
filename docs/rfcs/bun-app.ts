import { FileBlob, ServeOptions, Server } from "bun";

import { BuildManifest, BuildOptions, BuildResult, LazyBuildResult } from "./bun-bundler-config";

interface AppOptions extends BuildOptions {
  serve?: Array<
    | {
        mode: "static";
        dir: string; // directory to serve, usually the build dir
        requestPrefix?: string; // request prefix, e.g. "/static"
      }
    | {
        mode: "handler";
        requestPrefix?: string; // request prefix, e.g. "/static"
        handler: string; // e.g. ./serve.tsx. must match an entrypoint.
      }
  >;
}

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
  constructor(options: AppOptions | (AppOptions | undefined)[]);
  // run a build and start the dev server
  serve(options: Partial<ServeOptions>): Promise<Server>;
  // run full build
  build(options?: {
    // all output directories are specified in `AppOptions`
    // the `write` flag determines whether the build is written to disk
    // if write = true, the Blobs are BunFile
    // if write = false, the Blobs are just Blobs
    write?: boolean;
  }): Promise<BuildResult<Blob>>;

  handle(req: Request): Promise<Response | null>;
}

interface HandlerContext {
  manifest: BuildManifest;
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
          requestPrefix: "/api",
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
