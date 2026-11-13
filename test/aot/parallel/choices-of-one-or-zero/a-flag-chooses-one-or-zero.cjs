// STATISTIC: ConditionalsConvertedToNumbers >= 4
"use strict";
const shelves = [{ marks: 1, books: [1, 2, 3] }, { marks: 0, books: [1, 2] }, { marks: 3, books: [1] }, { marks: 2, books: [] }, { marks: -1, books: [4] }, { marks: 2147483647, books: [4, 5] }, { marks: -2147483648, books: [6] }];
function hasMark(shelf) { return !!(shelf.marks & 1); }
function free(shelf) { return shelf.books.length - ((shelf.marks & 1) ? 1 : 0); }
function freeByHelper(shelf) { return shelf.books.length - (hasMark(shelf) ? 1 : 0); }
function turnedRound(shelf) { return shelf.books.length - ((shelf.marks & 1) ? 0 : 1); }
function otherNumbers(shelf) { return shelf.books.length - ((shelf.marks & 1) ? 2 : 0); }
function widerMask(shelf) { return shelf.books.length - ((shelf.marks & 3) ? 1 : 0); }
function workOnAnArm(shelf, log) { return shelf.books.length - ((shelf.marks & 1) ? (log.push(shelf.marks), 1) : 0); }
const log = [];
let said = "";
for (let turn = 0; turn < 28; turn++) { const shelf = shelves[turn % 7]; said += free(shelf) + "," + freeByHelper(shelf) + "," + turnedRound(shelf) + "," + otherNumbers(shelf) + "," + widerMask(shelf) + "," + workOnAnArm(shelf, log) + ";"; }
console.log(said, log.join());
