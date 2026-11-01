const TITLE = "  the quick  brown fox ";
const words = TITLE.trim().split(/\s+/);
const titled = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const slug = words.join("-");
const initials = words.map((w) => w[0]).join("").toUpperCase();
console.log(titled, slug, initials, TITLE.length, words.length);
