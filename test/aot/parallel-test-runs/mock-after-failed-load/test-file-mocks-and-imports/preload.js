Bun.plugin({ name: "texts", setup(build) {
  build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; });
} });
