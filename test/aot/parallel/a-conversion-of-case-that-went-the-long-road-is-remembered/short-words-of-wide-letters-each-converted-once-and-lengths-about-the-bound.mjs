const letters = "аБвГдЕжЗиК";
const words = [];
for (let n = 0; n < 300; n++) { let word = ""; for (let j = 0; j < 1 + (n % 9); j++) word += letters[(n * 7 + j * 3) % 10]; words.push(JSON.parse(JSON.stringify(word))); }
let hash = 7;
for (const word of words) for (const text of [word.toLowerCase(), word.toUpperCase()]) for (let j = 0; j < text.length; j++) hash = (hash * 31 + text.charCodeAt(j)) % 1000003;
const about = [];
for (const length of [62, 63, 64, 65, 66, 130]) { const text = JSON.parse(JSON.stringify(letters.repeat(13).slice(0, length))); for (let turn = 0; turn < 3; turn++) about.push(text.toLowerCase() === text.toLowerCase(), text.toLowerCase().length === length, text.toUpperCase().toLowerCase() === text.toLowerCase(), text.toLowerCase() !== text); }
console.log(hash, about.every(Boolean), about.length);
