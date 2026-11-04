// texts that the build has not seen, narrow and wide, flat and joined, with pairs and with lone surrogates, are asked whether they are well formed
const box = JSON.parse('["plain","","caf\\u00e9","\\u0100","\\ud800","a\\udc00b","a\\ud83d\\ude00","\\ude00\\ud83d"]');
function sound(text) {
  const answer = text.isWellFormed();
  return String(answer);
}
function deed(first, second) {
  return first + second;
}
for (let i = 0; i < box.length; i++) console.log(sound(box[i]));
for (let i = 0; i < box.length; i++) console.log(sound(deed(box[i], box[(i + 3) % box.length])));
console.log(sound(deed(box[4], box[5].slice(1, 2))));
let wellFormed = 0;
for (let i = 0; i < 300; i++) if (sound(box[i % box.length]) === "true") wellFormed++;
console.log(String(wellFormed));
console.log(sound({ isWellFormed: () => "a record" }));
try { sound(null); } catch (error) { console.log(error.name); }
