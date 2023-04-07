import { FileBlob, ServeOptions, Server } from "bun";

import { BuildManifest, BuildOptions, BuildResult, BundlerOptions, LazyBuildResult } from "./bun-bundler";

interface EngineOptions extends BuildOptions {
  build?: boolean; // disable building/bundling
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

export declare class Engine {
  constructor(options: EngineOptions | (EngineOptions | undefined)[]);
  // start dev server
  serve(options: Partial<ServeOptions>): Promise<Server>;
  // run full build
  build(options?: {
    // all output directories are specified in `EngineOptions`
    // this disables writing to disk
    write?: boolean;
  }): Promise<BuildResult<Blob>>;

  handle: (
    req: Request,
    options: { prefix?: string }, // prefix to remove from req.url
  ) => Promise<FileBlob | null>;
}

// simple static file server
{
  const server = new Engine([
    {
      name: "static server",
      // disable all buildling
      // this just copies files to outdir on build
      build: false,
      entrypoints: ["./public"], // path to static directory
      outdir: "./.build/client",
      serve: [
        {
          mode: "static",
          dir: "./.build/client",
        },
      ],
      // bundler config
    },
    //
  ]);

  // serves files from `./public` on port 3000
  await server.serve({
    port: 3000,
  });

  // writes all files to `.build/client`
  await server.build();
}

// simple HTTP server
{
  /**
   * // handler.tsx
   *
   * export default (req: Request) => {
   *   return new Response("hello world");
   * }
   */
  const bundler = new Engine([
    {
      name: "simple HTTP server",
      target: "bun",
      entrypoints: ["./handler.tsx"], // path to static directory
      outdir: "./.build/server",
      serve: [
        {
          mode: "handler",
          handler: "./handler.tsx",
          requestPrefix: "/api",
        },
      ],
      // bundler config
    },
    //
  ]).serve({
    port: 3000,
  });
}

// SSR react, pages directo
{
  /**
   * // handler.tsx
   *
   * import {renderToReadableStream} from "react-dom/server";
   *
   * export default (req: Request, context: HandlerContext) => {
   *   const { manifest } = context;
   *   const path = new URL(req.url).pathname;
   *   const builtComponent = manifest.inputs.get(".pages/" + path + ".tsx");
   *
   *   const {default:Page} = await import(builtComponent)
   *   const stream = renderToReadableStream(builtComponent);
   *   return new Response(stream)
   * }
   */

  const router = new Bun.FileSystemRouter({
    dir: "./app",
    style: "nextjs",
  });

  const app = new Engine([
    {
      name: "SSR'd react, pages dir",
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
