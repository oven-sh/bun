// A string that is used as a name adopts the characters of an equal name, which may be 16-bit. The 8-bit strings that were joined with it, or cut from it, before are joined with others as before.
const text = "sdloh seman trohs fo elbat on taht eman gnol a".split("").reverse().join("");
function parts() { return [text.slice(0, 9), text.slice(9)].join(""); }
const wide = Buffer.from(text, "utf16le").toString("utf16le");
const names = {};
names[wide] = 1;
const makers = {
  front: name => name + "!", back: name => "!" + name, both: name => name + name, cut: name => name.slice(2), cutEnd: name => name.slice(0, -2), three: name => "<" + name + ">", pair: name => name.slice(1) + name,
};
function join(list, separator) { return list.join(separator); }
const uses = {
  listed: string => join([string, "x"], ""), listedByCommas: string => join([string, string, 5], ","), listedByNothing: string => join([1, string, null], ""), listedByText: string => join([string, 2, string], "--"), listedWithFractions: string => join([0.5, string, 1.5, string]), listedInLists: string => join([string, [string, 1], string], ";"), listedLong: string => join([string, "y".repeat(600), string], "+"),
 
  joined: string => [string, "x"].join(""), commas: string => [string, string, 5].join(), list: string => String([string, [string, 1.5]]), few: string => [1, string, null].join("-"), many: string => Array.from({ length: 40 }, () => string).join("+"), long: string => [string.slice(0, 40), string, "y".repeat(600)].join(""),
  sum: string => string + "z", template: string => `${string}${string}`, grown: string => { let grown = ""; for (let i = 0; i < 5; i++) grown += string; return grown; }, upper: string => string.toUpperCase(), split: string => string.split(" ").join("|"), replaced: string => string.replaceAll("a", "A"), matches: string => String(string.match(/a/g)), key: string => Object.keys({ [string]: 1 })[0], json: string => JSON.stringify([string]), map: string => [...new Map([[string, 1]]).keys()][0], characters: string => { let code = 0; for (let i = 0; i < string.length; i++) code = code * 31 + string.charCodeAt(i) | 0; return code; }, repeated: string => string.repeat(2), padded: string => string.padEnd(70, "."), bytes: string => Buffer.from(string).toString("hex").slice(0, 60), order: string => string < text, ends: string => [string.startsWith(text), string.endsWith("holds"), string.indexOf("table"), string.includes("name th")].join(),
};
for (const use in uses) for (const maker in makers) {
  const name = parts(), string = makers[maker](name);
  names[name] = 2;
  const got = uses[use](string), wanted = uses[use](makers[maker](text) + "");
  if (got !== wanted) console.log(use, maker, JSON.stringify(got), JSON.stringify(wanted));
}
console.log(Object.keys(uses).length * Object.keys(makers).length);
