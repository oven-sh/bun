globalThis.said = [];
globalThis.listed = () => Object.keys(require.cache).filter(key => /[\\/](north|south|east)\.m?[jt]s$/.test(key)).map(key => key.replace(/^.*[\\/]/, "")).sort().join(",") || "none";
