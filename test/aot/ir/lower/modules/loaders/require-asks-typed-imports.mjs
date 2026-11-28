// `require()` of a file of data answers the value that an import holds: one without a type, or one under the type that the name of the file says, which is the same module.
// An import under another type makes another module, which answers no `require()` without that type.
// A member of a held value is read off the object: a store through what `require()` answers shows there. What no `require()` names keeps its one answer.
// RUN(TEXT): link
// TEXT: module [[text]] path="{{*}}data.json?text" displayPath={{*}}requireResult=DefaultExport typeAttribute="text"
// TEXT-NOT: = RequireModule module=[[text]]
// RUN(JSON): link
// JSON: module [[json]] path="{{*}}data.json" displayPath={{*}}requireResult=HeldDefaultExport {{*}}exports=[{name="a"{{*}}{name="default"{{*}}{name="list"
// JSON: = RequireModule module=[[json]] {{*}}specifier="./data.json" @
// RUN(UNTYPED): link
// UNTYPED: module [[plain]] path="{{*}}plain.json" displayPath={{*}}requireResult=HeldDefaultExport
// UNTYPED: = RequireModule module=[[plain]] {{*}}specifier="./plain.json" @
// RUN(ONCE): link
// ONCE-NOT: .json?json
// ONCE-NOT: onlyIfImported
// RUN(ALONE): link
// ALONE: module {{*}}path="{{*}}alone.json" displayPath={{*}}requireResult=DefaultExport {{*}}exports=[{name="default"

// RUN(MEMBERS): lower
// MEMBERS-NOT: string="of the held file"
// MEMBERS: = PropGet {{*}}key="mark"
// MEMBERS-NOT: key="sign"
// MEMBERS: = String string="of the file alone"
// MEMBERS-NOT: key="sign"
// MEMBERS-NOT: string="of the held file"

// FILE: main.mjs
import typed from "./data.json" with { type: "json" };
import text from "./data.json" with { type: "text" };
import held from "./held.json" with { type: "json" };
import plain from "./plain.json";
import plainTyped from "./plain.json" with { type: "json" };
import alone from "./alone.json" with { type: "json" };
export const imported = [typed, text, plain, plainTyped];
export const required = [require("./data.json"), require("./held.json"), require("./plain.json"), require("./required.json")];
export const members = [held.mark, alone.sign];

// FILE: data.json
{ "a": 1, "list": [1, 2] }

// FILE: held.json
{ "mark": "of the held file" }

// FILE: plain.json
{ "a": 1 }

// FILE: required.json
{ "a": 1 }

// FILE: alone.json
{ "sign": "of the file alone" }
