const result = await Bun.build({
  entrypoints: ["input/index.ts"],
  outdir: "dist",
  plugins: [
    {
      name: "mdx",
      setup(build) {
        const plugin = require("/Users/zackradisic/Code/bun/packages/bun-build-mdx-rs/bun-mdx-rs.darwin-arm64.node");

        build.onBeforeParse({ filter: /\.mdx$/ }, { napiModule: plugin, symbol: "bun_mdx_rs" });
      },
    },
  ],
});

console.log(result);
