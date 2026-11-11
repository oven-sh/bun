const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"texts":["a","b","c","d"]}');
export let table = parsed.numbers;
export function swap() { table = parsed.texts; }
