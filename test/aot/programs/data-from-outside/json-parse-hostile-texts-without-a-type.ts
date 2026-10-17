import { parseEveryText } from "./json-parse-into-declared-types/texts";
const parse = JSON.parse;
parseEveryText([
  ["no type", text => JSON.parse(text)],
  ["no type, once more", text => JSON.parse(text)],
  ["an undefined reviver", text => JSON.parse(text, undefined)],
  ["through a variable", text => parse(text)],
]);
