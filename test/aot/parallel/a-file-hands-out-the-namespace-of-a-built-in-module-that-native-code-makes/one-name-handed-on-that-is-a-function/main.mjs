const { peek } = await import("./parts.mjs"); console.log("SAID", peek(Promise.resolve(1)));
