const wanted = JSON.parse('["fetch","WebSocket","structuredClone","Worker","navigator","nothing"]');
for (const word of wanted) console.log(word, word in globalThis);
console.log("end");
