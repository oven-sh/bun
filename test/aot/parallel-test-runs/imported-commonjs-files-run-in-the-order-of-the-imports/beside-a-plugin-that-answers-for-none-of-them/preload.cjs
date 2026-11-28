Bun.plugin({ name: "idle", setup: build => void build.onResolve({ filter: /^never$/ }, () => undefined) });
