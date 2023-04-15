import { FileBlob } from "bun";
import { BuildConfig, BuildResult, BundlerConfig, LazyBuildResult } from "./bun-build-config";

namespace Bun {
  export declare function build(config: BuildConfig): BuildResult<Blob>;
}

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
