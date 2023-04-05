import { Bundler } from "./bun-bundler";

const bundler = new Bundler({
  // ...
});

const router = new Bun.FileSystemRouter({
  dir: "./app",
  style: "nextjs",
});

const multistageBuild = bundler
  .makeBuild({
    // server build
    target: "bun",
    entrypoints: Object.values(router.routes),
    bundle: true,
    splitting: true,
    naming: "rsc/[dir]/[name]-[hash].[ext]", // write to <builddir>/rsc
    plugins: [
      {
        name: "rsc",
        setup(build: any) {
          // new hook: onBuild
          // this is where we'd support various AST transforms in the future
          build.onBuild(
            { directive: "client" },
            (args: {
              path: string;
              resolveDir: string;
              module: {
                directive?: string;
                id: string;
                exports: string[];
              };
            }) => {
              // per-build `context` object
              // initialized to {}
              build.context.clientModules = build.context.clientModules || {};
              build.context.clientModules[args.resolveDir + "/" + args.path] = true;

              // future APIs
              // client references
              const exports: any = {};
              for (const key in args.module.exports) {
                exports[key] = {
                  $$typeof: Symbol.for("react.client.element"),
                  $$id: args.module.id,
                  $$async: true,
                };
              }
              return {
                loader: "object",
                exports,
              };
            },
          );
        },
      },
    ],
  })
  .then(context => ({
    entrypoints: ["./client-entry.tsx", ...Object.keys(context.clientModules)],
    target: "browser",
    bundle: true,
    splitting: true,
    naming: "client/[dir]/[name]-[hash].[ext]",
    plugins: [],
  }))
  .then(context => ({
    entrypoints: ["./ssr-entry.tsx", ...Object.keys(context.clientModules)],
    target: "bun",
    bundle: true,
    splitting: true,
    naming: "ssr/[dir]/[name]-[hash].[ext]",
    plugins: [],
  }))
  .write("/.build");
