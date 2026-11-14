const text = await import("./conf.toml", { with: { type: "text" } });
postMessage(typeof text.default);
