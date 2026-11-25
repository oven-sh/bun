(globalThis as any).shelf = { make: () => new Set([1, 2, 3]).values(), own: () => { let at = 0; return { next() { return at++ < 3 ? { done: false, value: at } : { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } }; } };
const shelf: any = (globalThis as any).shelf;
function seen(items: any): string { let text = ""; for (const item of items) { text += String(item) + ";"; items.next = () => ({ done: false, value: "replaced" }); if (text.length > 40) break; } return text; }
let out = ""; for (let round = 0; round < 3; round++) out += seen(shelf.make()) + "|" + seen(shelf.own()) + "|"; console.log(out);
