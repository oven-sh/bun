// Each type makes a module of its own, but for the type that the name of the file says, which asks for the file itself. A call under another type takes nothing of what a statement holds.
// A call whose type the build does not know may get it: that file keeps all its exports.

// RUN(TEXT): link
// TEXT: module {{*}}path="{{*}}first.toml?text" displayPath={{*}}typeAttribute="text"

// RUN(BARE): link
// BARE-NOT: path="{{*}}first.toml?toml" displayPath
// BARE-NOT: path="{{*}}second.yaml?yaml" displayPath
// BARE-NOT: path="{{*}}third.toml?toml" displayPath
// BARE-NOT: path="{{*}}fourth.json?json" displayPath

// RUN(COMPUTED): link
// COMPUTED: module {{*}}path="{{*}}third.toml" displayPath={{*}}exports=[{name="a" variable=[[a]]}, {name="b" variable=[[b]]}, {name="default"

// RUN(JSON): link
// JSON: module {{*}}path="{{*}}fourth.json" displayPath={{*}}exports=[{name="a" variable=[[whole]] isOmitted=true}, {name="b" variable=[[whole]] isOmitted=true}, {name="default" variable=[[whole]]}]

// RUN(UNTYPED): link
// UNTYPED: module {{*}}path="{{*}}fifth.toml" displayPath={{*}}exports=[{name="a" variable=[[whole]] isOmitted=true}, {name="b" variable=[[whole]] isOmitted=true}, {name="default" variable=[[whole]]}]

// RUN(MEMBERS): lower
// MEMBERS-NOT: key="mark"
// MEMBERS: = String string="asked for as text too"
// MEMBERS-NOT: key="sign"
// MEMBERS: = String string="reached by the static import alone"

// FILE: main.mjs
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
import typed from "./third.toml" with { type: "toml" };
import json from "./fourth.json" with { type: "json" };
import plain from "./fifth.toml";
import held from "./held.toml" with { type: "toml" };
import alone from "./alone.toml" with { type: "toml" };
export const imported = [toml, yaml, typed, json, plain];
const options = { with: { type: globalThis.type } };
export const calls = [
  import("./first.toml", { with: { type: "text" } }),
  import("./second.yaml", { with: { type: "text" } }),
  import("./third.toml", options),
  import("./fourth.json", { with: { type: "text" } }),
  import("./fifth.toml", { with: { type: "text" } }),
  import("./held.toml", { with: { type: "text" } }),
];
export const members = [held.mark, alone.sign];

// FILE: first.toml
a = 1
b = 2

// FILE: second.yaml
a: 1
b: 2

// FILE: third.toml
a = 1
b = 2

// FILE: fourth.json
{ "a": 1, "b": 2 }

// FILE: fifth.toml
a = 1
b = 2

// FILE: held.toml
mark = "asked for as text too"

// FILE: alone.toml
sign = "reached by the static import alone"
