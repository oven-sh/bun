// Objects that are only asked whether they have a key: a table of words, an instance and a class with static fields. Nobody reads the values, and the key comes from a variable.
const words = { if: true, else: true, while: true };
function isWord(text) { return words.hasOwnProperty(text); }
function isWord2(text) { return Object.hasOwn(words, text); }
function isWord3(text) { return Object.prototype.hasOwnProperty.call(words, text); }
function isWord4(text) { return words.propertyIsEnumerable(text); }
function isWord5(text) { return text in words; }
function isWord6(text) { return Reflect.has(words, text); }
function isWord7(text) { return Object.getOwnPropertyDescriptor(words, text) !== undefined; }
const list = process.argv.length > 5 ? ["x"] : ["if", "for", "while"];
for (const ask of [isWord, isWord2, isWord3, isWord4, isWord5, isWord6, isWord7]) console.log(ask.name, list.map(ask).join(" "));
class Made { constructor() { this.late = 1; this.other = 2; } }
const made = new Made();
const key = list[0] === "if" ? "late" : "x";
console.log(Object.hasOwn(made, key), made.hasOwnProperty(key), made.propertyIsEnumerable(key), made.propertyIsEnumerable("other"), made.hasOwnProperty("other"));
class Flags { static debug = 1; static trace = 2; }
const flag = list[0] === "if" ? "debug" : "x";
console.log(Object.hasOwn(Flags, flag), Flags.hasOwnProperty(flag), Flags.propertyIsEnumerable(flag), Flags.propertyIsEnumerable("trace"), Flags.hasOwnProperty("trace"));
