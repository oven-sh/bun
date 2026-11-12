const input = JSON.parse('{"lists":[[],[1],[1,2],[1,2,3],[1,2,3,4],[1,2,3,4,5],[1,2,3,4,5,6],[1,2,3,4,5,6,7,8,9]],"texts":["a","bb","ccc"]}');
const { lists, texts } = input;
const said = [];
for (let turn = 0; turn < 300; turn++) { said.length = 0; for (const list of lists) said.push(list.filter(() => true).join(), list.filter(() => false).length, list.filter((v) => v & 1).join()); }
console.log(JSON.stringify(said));
