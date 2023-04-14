import { FileBlob } from "bun";
import { BuildOptions, LazyBuildResult } from "./bun-bundler-config";
export declare class Bundler {
  constructor(options: BuildOptions);
  makeBuild: (options: BuildOptions) => LazyBuildResult;
  handle: (
    req: Request,
    options: { prefix?: string }, // prefix to remove from req.url
  ) => Promise<FileBlob | null>;
  rebuild(): Promise<void>;
}

// simple build, writes to disk
{
  const bundler = new Bundler({});
  bundler
    .makeBuild({
      entrypoints: ["index.js"],
    })
    .write("./build");
}

// simple build, returns results as Blob
{
  const bundler = new Bundler({});
  const result = await bundler
    .makeBuild({
      entrypoints: ["index.js"],
    })
    .run();

  console.log(result.outputs[0].path);
  console.log(result.outputs[0].result);
}
