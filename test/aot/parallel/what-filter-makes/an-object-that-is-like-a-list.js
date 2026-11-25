const input = JSON.parse('{"lists":[[],[1],[1,2],[1,2,3],[1,2,3,4],[1,2,3,4,5],[1,2,3,4,5,6],[1,2,3,4,5,6,7,8,9]],"texts":["a","bb","ccc"]}');
const { lists, texts } = input;
const said = [];
for (let turn = 0; turn < 300; turn++) { said.length = 0; said.push(Array.prototype.filter.call({ length: 3, 0: "a", 2: "c" }, () => true).join(), Array.prototype.filter.call({ length: -1, 0: "a" }, () => true).length, Array.prototype.filter.call({ length: NaN }, () => true).length, Array.prototype.filter.call("text", (c) => c !== "e").join("")); }
console.log(JSON.stringify(said));
