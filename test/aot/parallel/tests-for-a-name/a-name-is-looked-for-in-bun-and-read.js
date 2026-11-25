const wanted = JSON.parse('["version","sql","nothing"]');
for (const word of wanted) console.log(word, word in Bun);
console.log("end", typeof Bun.sql);
