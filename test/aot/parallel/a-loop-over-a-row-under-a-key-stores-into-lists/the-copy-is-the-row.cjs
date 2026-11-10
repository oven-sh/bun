"use strict";
// `for (..; i < data[w].length; ..) { copy[i] = data[w][i]; }`: the row under the key is read once in front; a store into a list may, for all the walk knows, reach the holder, so in the turn the row is held against its
// place in the holder: its shape and the word that lies there. Who fails begins the turn again as written. Whatever is handed, the answer is plain's. HERE: `copy` IS `data[w]`.
const zero = JSON.parse("0"), made = () => JSON.parse('{"rows":[1,2,3,4,5,6,7,8,9,10,11,12],"other":[100,200,300]}');
let counted = 0;
const held = made(), list = held.rows, more = 0;
function row(data, w, copy, extra) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; copy[(i + 1) % 12] = i; } return s; }
const tried = (run) => { try { return String(run()); } catch (error) { return error.name; } };
console.log(tried(() => row([held][zero], ["rows"][zero], [list][zero], [more][zero])), counted, tried(() => row([held][zero], ["rows"][zero], [list][zero], [more][zero])), counted, JSON.stringify(held), JSON.stringify(list));
