// The uses say a list of lists; what comes is something else: rows that are texts, views, array-likes, null, numbers; a grid that is a text, an array-like, null.
"use strict";
const mixed = JSON.parse('[[1,2,3],"456",{"length":2,"0":7,"1":8},[1.5,null,"x"],[],7,[[1],[2]]]');
mixed.push(new Uint8Array([9, 10]), new Float64Array([0.5]), Object.assign([1, 2], { length: 4 }));
function sumMixed() { let s = 0; for (let y = 0; y < mixed.length; y++) for (let x = 0; x < mixed[y].length; x++) s = s + mixed[y][x]; return s; }
const text = JSON.parse('"abc"');
function sumText() { let s = ""; for (let y = 0; y < text.length; y++) for (let x = 0; x < text[y].length; x++) s = s + text[y][x]; return s; }
const like = JSON.parse('{"length":2,"0":[1,2],"1":[3]}');
function sumLike() { let s = 0; for (let y = 0; y < like.length; y++) for (let x = 0; x < like[y].length; x++) s = s + like[y][x]; return s; }
const nothing = JSON.parse("null");
function sumNothing() { let s = 0; for (let y = 0; y < nothing.length; y++) for (let x = 0; x < nothing[y].length; x++) s = s + nothing[y][x]; return s; }
const holed = JSON.parse("[[1,2],null,[3]]");
function sumHoled() { let s = 0; for (let y = 0; y < holed.length; y++) for (let x = 0; x < holed[y].length; x++) s = s + holed[y][x]; return s; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name); } }
for (let round = 0; round < 100; round++) { sumMixed(); sumText(); sumLike(); }
tell(sumMixed); tell(sumText); tell(sumLike); tell(sumNothing); tell(sumHoled);
console.log(said.join(" | "));
