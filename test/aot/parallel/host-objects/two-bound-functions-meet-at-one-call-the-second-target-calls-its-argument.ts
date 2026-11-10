const acts = [Array.isArray.bind(null), queueMicrotask.bind(null)];
for (const act of acts) console.log(act(() => console.log("ran")));
