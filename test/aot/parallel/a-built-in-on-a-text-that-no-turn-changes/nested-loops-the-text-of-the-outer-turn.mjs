const words = JSON.parse('["One","TWO","three"]'), list = JSON.parse('["one","two","three","two"]');
let n = "";
for (let j = 0; j < words.length; j++) { let c = 0; for (let i = 0; i < list.length; i++) if (list[i] === words[j].toLowerCase()) c++; n += c; }
console.log(n);
