const wanted = JSON.parse('["pid","finalization","nothing"]');
for (const word of wanted) console.log(word, word in process);
console.log("end", typeof process.finalization);
