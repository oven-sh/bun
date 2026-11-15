const input = JSON.parse('{"lists":[[],[1],[1,2],[1,2,3],[1,2,3,4],[1,2,3,4,5],[1,2,3,4,5,6],[1,2,3,4,5,6,7,8,9]],"texts":["a","bb","ccc"]}');
const { lists, texts } = input;
const said = [];
for (let turn = 0; turn < 300; turn++) { said.length = 0; for (const list of lists) { const source = list.slice(); said.push(source.filter((v) => { source.push(v + 10); return true; }).join(), source.length); } }
console.log(JSON.stringify(said));
