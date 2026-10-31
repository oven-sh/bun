// A part of a --define key that is no identifier stands in brackets and quotes. It names the member that a program reads in brackets, and a name that is not ASCII is the same member behind a dot and in brackets.
// Flags: --define=settings["retry-count"]=3 --define=settings["a.b"].c="deep" --define=labels.größe=5
// Reference: bun build --compile
console.log(
  settings["retry-count"],
  settings?.["retry-count"],
  settings[`retry-count`],
  typeof settings["retry-count"],
);
console.log(settings["a.b"].c, settings["a.b"]["c"], settings["a.b"]?.c, settings["a.b"].c.length);
console.log(labels.größe, labels["größe"], labels["gr\u00f6\u00dfe"], labels?.["größe"].toFixed(1));
