export const install = () => Bun.plugin({ name: "never", setup(build) { build.onLoad({ filter: /[.]never$/ }, () => ({ contents: "", loader: "js" })); } });
