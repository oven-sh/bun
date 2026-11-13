// A short part of a wide string is cut without a call, however often it comes again.
// COUNT: operationAOTSubstring <= 6
const names = ["color", "width", "margin-left", "border", "display", "background", "float", "position", "opacity", "padding", "z-index", "transform"];
const text = names.join(";") + ";—";
const counts = Object.create(null);
let length = 0;
for (let round = 0; round < 40; ++round) {
    for (let start = 0, end; (end = text.indexOf(";", start)) >= 0; start = end + 1) {
        const name = text.slice(start, end);
        counts[name] = (counts[name] || 0) + 1;
        length += name.toUpperCase().length;
    }
}
console.log(length, names.every(name => counts[name] === 40), Object.keys(counts).length);
