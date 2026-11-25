const later = [holder => holder.process.nextTick(() => console.log("ticked", typeof holder.label))][JSON.parse("0")];
later(Object.defineProperty(globalThis, "label", { value: "two" }));
