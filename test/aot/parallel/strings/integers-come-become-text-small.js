// One integer becomes text twice, early. Then integers that come once become text while the program allocates enough for many small collections, and nothing else is written into the tables of texts.
// Flags: --aot-validate
let length = 0;
const kept = [];
for (let i = 300; i < 3_000_000; i++) {
    length += String(i).length;
    if (i === 5000) kept.push(String(i - 904));
}
console.log(length, kept.length, kept[0]);
