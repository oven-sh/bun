process.prependListener("exit", () => { throw new Error("exit listener throws"); });
try { process.exit(0); } catch {}
