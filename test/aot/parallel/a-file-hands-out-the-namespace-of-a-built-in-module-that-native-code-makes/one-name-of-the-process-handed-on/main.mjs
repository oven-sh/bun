const { nextTick } = await import("./parts.mjs"); console.log("SAID", typeof nextTick(() => {}));
