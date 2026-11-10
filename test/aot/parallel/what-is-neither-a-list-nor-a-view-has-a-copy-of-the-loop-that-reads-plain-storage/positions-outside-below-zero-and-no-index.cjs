// STATISTIC: ElementsReadInPlainStorageOfWhatIsNoList >= 3
"use strict";
// The counter begins below zero, the key lies below the counter, the counter runs past the last place and past the room, and the key passes the greatest index there is: what is no index of a place is read as a name.
const said = [];
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
function below(like) { let s = 0; for (let j = -2; j < like.length; j++) s += like[j]; return s; }
function under(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j - 2]; return s; }
function past(like) { let s = 0; for (let j = 0; j < like.length + 2; j++) s += like[j]; return s; }
function greatest(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j + 4294967292]; return s; }
for (let round = 0; round < 3; round++) {
    const holder = fresh(); said.push(String(below(holder)), String(under(holder)), String(past(holder)), String(greatest(holder)));
    holder[-1] = 20; holder[-2] = 40; said.push(below(holder), under(holder));
    holder[4] = 11; holder[5] = 13; said.push(past(holder));
    holder[4294967292] = 1; holder[4294967293] = 2; holder[4294967294] = 4; holder[4294967295] = 8; said.push(greatest(holder), below(holder), under(holder), past(holder));
}
console.log(said.join(" "));
