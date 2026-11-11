// A folder and a data file of the same name lie side by side: the file comes first, and the name with a slash at its end is the folder.
const path = require("path");
const rules = process.env.DATA_FILE_BESIDE_A_FOLDER || "rules";
const rulesFolder = process.env.DATA_FILE_BESIDE_A_FOLDER || "rules/";
const views = process.env.DATA_FILE_BESIDE_A_FOLDER || "views";
const parts = process.env.DATA_FILE_BESIDE_A_FOLDER || "parts";
const partsFolder = process.env.DATA_FILE_BESIDE_A_FOLDER || "parts/";

console.log("join", require(path.join(__dirname, rules)).from);
console.log("resolve", require(path.resolve(__dirname, rules)).from);
console.log("text", require(__dirname + "/" + rules).from);
console.log("template", require(`${__dirname}/${rules}`).from);
console.log("relative", require("./" + rules).from);
console.log("join, folder", require(path.join(__dirname, rulesFolder)).from);
console.log("resolve, folder", require(path.resolve(__dirname, rulesFolder)).from);
console.log("text, folder", require(__dirname + "/" + rulesFolder).from);
console.log("relative, folder", require("./" + rulesFolder).from);
console.log("no file", require(path.join(__dirname, views)).from, require(`${__dirname}/${views}`).from);
console.log("no file, resolve", require(path.resolve(__dirname, views)).from, require(path.resolve(__dirname, views + "/")).from);
console.log("code", require(path.join(__dirname, parts)).from, require(path.join(__dirname, partsFolder)).from);
console.log("code, resolve", require(path.resolve(__dirname, parts)).from, require(path.resolve(__dirname, partsFolder)).from);
