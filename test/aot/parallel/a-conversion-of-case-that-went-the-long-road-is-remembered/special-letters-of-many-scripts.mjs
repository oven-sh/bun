const texts = ["İstanbul İ", "ΣΑΣ σας ΟΔΟΣ", "ﬁﬂ ß ŉ", "ǅ Ǆ ǆ", "𐐀𐐨", "ẞ K Ω", "აბ ᲐᲑ", "áÉ", "\ud800 lone \udc00", ""];
const out = [];
for (let turn = 0; turn < 3; turn++) for (const text of texts) out.push(escape(text.toLowerCase()) + "/" + escape(text.toUpperCase()));
console.log(out.slice(0, texts.length).join(" "), out.slice(0, texts.length).join() === out.slice(texts.length, 2 * texts.length).join(), out.slice(0, texts.length).join() === out.slice(2 * texts.length).join());
