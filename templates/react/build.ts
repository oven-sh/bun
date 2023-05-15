// NODE_ENV=development bun build ./src/index.jsx --outfile ./.build/bundle.js

Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./build",
});
