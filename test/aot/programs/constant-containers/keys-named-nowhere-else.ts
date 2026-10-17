// Keys and values of constant Sets and Maps whose text is also the name of a variable, a field or a regular expression and stands nowhere else as a string.
const onlyAVariableName = 1;
let anotherVariableName = 2;
const pattern = /onlyAPattern/u;
const NAMES = new Set(["onlyAVariableName", "anotherVariableName", "onlyAPattern", "u", "NAMES"]);
const VALUES = new Map([["first", "VALUES"], ["second", "holder"], ["third", "onlyAFieldName"]]);
const holder: { onlyAFieldName: "onlyALiteralType" | "other" } = { onlyAFieldName: Date.now() > 0 ? "other" : "onlyALiteralType" };
const TYPES = new Set(["onlyALiteralType"]);
anotherVariableName += onlyAVariableName;
function ask(text: string) {
    return NAMES.has(text) + " " + TYPES.has(text) + " " + VALUES.get(text);
}
console.log(ask("only" + "AVariableName".slice(0)), ask("first"), ask("third"), ask("onlyALiteralType".slice(0)), anotherVariableName, pattern.test("x"), holder.onlyAFieldName);
console.log([...NAMES].join(), [...TYPES].join(), [...VALUES].join(";"));
