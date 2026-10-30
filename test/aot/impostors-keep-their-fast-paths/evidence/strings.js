import { parsed } from "./out-of-sight.js";

function sumOfCodes(text) {
  let total = 0;
  for (let i = 0; i < text.length; i++) total += text.charCodeAt(i);
  return total;
}

function countLetterA(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "a") count++;
  return count;
}

function comesBeforeM(word) {
  return word < "m";
}

function comparisonWithString(words) {
  let count = 0;
  for (let i = 0; i < 100; i++) if (comesBeforeM(words[i])) count++;
  return count;
}

function countCharacters(text) {
  let count = 0;
  for (const character of text) if (character !== " ") count++;
  return count;
}

function parseAll(texts) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += parseInt(texts[i], 10);
  return total;
}

function lengthsOfParts(text) {
  const parts = text.split(",");
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  return total;
}

const letters = "abcdefghijklmnopqrstuvwxyz";
const hundredLetters = JSON.stringify((letters + letters + letters + letters).slice(0, 100));
const hundredWords = JSON.stringify(Array.from({ length: 100 }, (_, i) => letters[i % 26] + "x"));

export const cases = {
  "the result of split is read under a number": {
    prepare: () => parsed(JSON.stringify("ab,".repeat(99) + "ab")),
    turn: lengthsOfParts,
  },
  "charCodeAt is called under an index up to the length": { prepare: () => parsed(hundredLetters), turn: sumOfCodes },
  "characters are read under a number": { prepare: () => parsed(hundredLetters), turn: countLetterA },
  "a value is compared with a string": { prepare: () => parsed(hundredWords), turn: comparisonWithString },
  "a string is walked with for-of": { prepare: () => parsed(hundredLetters), turn: countCharacters },
  "a value is an argument of parseInt": {
    prepare: () => parsed(JSON.stringify(Array.from({ length: 100 }, (_, i) => String(i)))),
    turn: parseAll,
  },
};
