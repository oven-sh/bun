import { FileBlob } from "bun";
import { BuildConfig, BuildManifest, BundlerConfig } from "./bun-build-config";
import { Log } from "./bun-build-logs";

namespace Bun {
  export declare function build(config: BuildConfig): BuildResult<Blob>;
}

export type BuildResult<T> = {
  // T will usually be a FileBlob
  // or a Blob (for in-memory builds)
  outputs: { path: string; result: T }[];
  // only exists if `manifest` is true
  manifest?: BuildManifest;
  log: Log;
};

// simple build, writes to disk
{
  Bun.build({
    target: "bun",
    entrypoints: ["index.js"],
    naming: "[name]-[hash].[ext]",
    outdir: "./build",
  });
}

// RSC
{
  Bun.build({
    target: "bun",
    entrypoints: ["index.js"],
    naming: "[name]-[hash].[ext]",
    outdir: "./build",
    plugins: [
      //@ts-ignore
      BunPluginRSC({
        client: {
          entrypoints: ["client-entry.ts"],
          outdir: "./build/client",
          /* ... */
        },
        ssr: {
          entrypoints: ["ssr-entry.ts"],
          outdir: "./build/ssr",
          /* ... */
        },
      }),
    ],
  });
}
