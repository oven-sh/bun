const wanted = JSON.parse('["nextTick","allowedNodeEnvironmentFlags","stdout","nothing"]');
for (const word of wanted) console.log(word, word in process);
console.log("end");
