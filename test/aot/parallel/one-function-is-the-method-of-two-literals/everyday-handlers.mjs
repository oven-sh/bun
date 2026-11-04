function label() { let text = ""; for (const part of [this.kind, this.size]) text += part + ";"; return text; }
function show(item) { let line = ""; for (let i = 0; i < 1; i++) line += item.label(); return line; }
const circle = { kind: "circle", size: 3, radius: 3, label };
const note = { author: "ann", text: "hi", kind: "note", size: "small", label };
const page = { sidebar: { pinned: note } };
console.log(show(circle), show(page.sidebar.pinned));
