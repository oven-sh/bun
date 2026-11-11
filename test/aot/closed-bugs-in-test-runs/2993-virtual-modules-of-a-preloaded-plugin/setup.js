import { plugin } from "bun";
plugin({ name: "from the preload", setup(build) {
  build.module("virtual:preloaded", () => ({ exports: { default: "preloaded", name: "p" }, loader: "object" }));
  build.module("virtual:static", () => ({ exports: { default: "static", name: "s" }, loader: "object" }));
  build.module("virtual:source", () => ({ contents: "export default 'source text';", loader: "js" }));
  build.onResolve({ filter: /^resolved:/ }, args => ({ path: args.path.slice(9), namespace: "made" }));
  build.onLoad({ filter: /.*/, namespace: "made" }, args => ({ contents: "export default " + JSON.stringify("made " + args.path) + ";", loader: "js" }));
} });
