// `require()` of a file of data answers what an import has made of the file: the namespace object. It asks the imports without a type first, then those under a type, those under
// "json" last, and reads the file itself where the loader holds none of them. Every name of such a module is kept for the namespace object, though the statements take the default
// alone, and a member of its value is read off the object: a store through what `require()` answers shows there. What no `require()` names keeps its one answer.

// RUN(SHAPE): lower
// SHAPE: [[first]] = RequireModule module=[[m1]] referrer=[[main]] specifier="./data.json" [ifHeldForImport]
// SHAPE-NEXT: [[isFirst]] = TypeTest [[first]] testedType=object
// SHAPE-NEXT: Branch [[isFirst]] -> taken [[done]]([[first]]), notTaken [[next]]()
// SHAPE-NEXT: [[next]]():
// SHAPE-NEXT: [[second]] = RequireModule module=[[m2]] referrer=[[main]] specifier="./data.json" [ifHeldForImport]
// SHAPE-NEXT: [[isSecond]] = TypeTest [[second]] testedType=object
// SHAPE-NEXT: Branch [[isSecond]] -> taken [[done]]([[second]]), notTaken [[last]]()
// SHAPE-NEXT: [[last]]():
// SHAPE-NEXT: [[read]] = RequireModule module=[[m3]] referrer=[[main]] specifier="./data.json"
// SHAPE-NOT: ifHeldForImport
// SHAPE: Jump -> next [[done]]([[read]])
// SHAPE-NEXT: [[done]]([[answer]]):

// RUN(TEXT): link
// TEXT: module [[text]] path="{{*}}data.json?text" displayPath={{*}}requireResult=NamespaceIfImported
// TEXT-NOT: = RequireModule {{*}}specifier="./data.json"
// TEXT: = RequireModule module=[[text]] {{*}}specifier="./data.json" [ifHeldForImport]

// RUN(JSON): link
// JSON: module [[json]] path="{{*}}data.json?json" displayPath={{*}}requireResult=NamespaceIfImported {{*}}exports=[{name="a"{{*}}{name="default"{{*}}{name="list"
// JSON: = RequireModule {{*}}specifier="./data.json" [ifHeldForImport]
// JSON: = RequireModule module=[[json]] {{*}}specifier="./data.json" [ifHeldForImport]

// RUN(ITSELF): link
// ITSELF: module [[file]] path="{{*}}data.json" displayPath={{*}}requireResult=DefaultExport {{*}}exports=[{name="a" variable=[[whole]] isLeftOut=true}, {name="default"
// ITSELF-COUNT-2: specifier="./data.json" [ifHeldForImport]
// ITSELF: = RequireModule module=[[file]] {{*}}specifier="./data.json"

// RUN(UNTYPED): link
// UNTYPED: module [[plain]] path="{{*}}plain.json" displayPath={{*}}requireResult=NamespaceIfImported
// UNTYPED-NOT: = RequireModule {{*}}specifier="./plain.json"
// UNTYPED: = RequireModule module=[[plain]] {{*}}specifier="./plain.json" [ifHeldForImport]
// UNTYPED: = RequireModule module=[[typed]] {{*}}specifier="./plain.json" [ifHeldForImport]
// UNTYPED: = RequireModule module=[[plain]] {{*}}specifier="./plain.json"
// UNTYPED-NOT: ifHeldForImport

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
