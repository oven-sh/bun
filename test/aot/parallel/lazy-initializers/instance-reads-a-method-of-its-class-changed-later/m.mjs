function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

export class Thing { label() { return "first"; } }
const t = new Thing();
const snap = { seen: t.label === Thing.prototype.label, big: make("x"), held: t.label };
export const read = () => snap;
