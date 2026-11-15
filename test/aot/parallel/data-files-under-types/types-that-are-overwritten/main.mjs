// The last property of a name counts, and a spread, a computed key or an accessor may stand behind the one that is written out.
const text = { type: "text" };
const key = String("type");
const other = { mode: "strict" };
const otherKey = String("mode");

const show = (label, module) => console.log(label, JSON.stringify(module.default));
show("a spread behind", await import("./a.txt", { with: { type: "json5", ...text } }));
show("a spread in front", await import("./b.txt", { with: { ...text, type: "json5" } }));
show("twice", await import("./c.txt", { with: { type: "text", type: "json5" } }));
show("an accessor behind", await import("./d.txt", { with: { type: "json5", get type() { return "text"; } } }));
show("an accessor in front", await import("./e.txt", { with: { get type() { return "text"; }, type: "json5" } }));
show("a computed key behind", await import("./f.txt", { with: { type: "json5", [key]: "text" } }));
show("options spread behind", await import("./g.txt", { with: { type: "json5" }, ...{ with: text } }));
const options = { with: { type: "json5", ...text } };
show("a constant", await import("./h.txt", options));
show("another name spread behind", await import("./i.txt", { with: { type: "json5", ...other } }));
show("another computed key behind", await import("./j.txt", { with: { type: "json5", [otherKey]: "strict" } }));
