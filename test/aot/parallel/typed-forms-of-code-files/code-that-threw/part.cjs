globalThis.ran = (globalThis.ran ?? 0) + 1;
throw new Error("part fails");
