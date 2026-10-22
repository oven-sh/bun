// What is expected of an expression that the checker types `any` is what its variable or its receiver is inferred to be, or what its own uses say.
function total(rows) {
  let sum = 0;
  // predicted `rows` = { size: { w?: number; }; }[]
  // predicted `rows.length` = number
  for (let i = 0; i < rows.length; i++) {
    // predicted `rows[i]` = { size: { w?: number; }; }
    // predicted `rows[i].size` = { w?: number; }
    // predicted `rows[i].size.w` = number
    sum += rows[i].size.w * 2;
  }
  return sum;
}
function read(text) {
  // predicted `JSON.parse(text)` = { name?: any; port?: number; }
  // binding `data` = { name?: any; port?: number; }
  const data = JSON.parse(text);
  // predicted `data.port` = number
  return [data.name, data.port + 1];
}
function direct(text) {
  // predicted `JSON.parse(text)` = { items: string | any[]; }
  // predicted `JSON.parse(text).items` = string | any[]
  return JSON.parse(text).items[0];
}
// A variable that the checker types `number` is int32, where it is declared and at each reference, if it starts as an integer, gets only integers and is a key.
function countPairs(list) {
  // binding `at` = int32
  let at = 0;
  // binding `pairs` = number
  let pairs = 0;
  // predicted `at` = int32
  // absent: predicted `pairs` = int32
  while (list[at]) { at += 2; pairs++; }
  // absent: predicted `pairs` = int32
  return pairs;
}
