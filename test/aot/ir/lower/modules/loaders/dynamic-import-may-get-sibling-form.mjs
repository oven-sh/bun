// import() with a type resolves to whatever the loader holds for the path and the kind of type: none, "json", or any other type. So it may get the form that a static import loaded under
// another type of the same kind. Such a sibling form keeps all its exports, and its members are not constant-folded. Both forms are keyed by type. A form of another kind is unaffected.

// RUN(TOML): link
// TOML: module {{*}}path="{{*}}first.toml?toml" displayPath={{*}}exports=[{name="a"{{*}}{name="b"{{*}}{name="default"

// RUN(TEXT): link
// TEXT: module {{*}}path="{{*}}first.toml?text" displayPath

// RUN(BARE): link
// BARE-NOT: path="{{*}}first.toml" displayPath

// RUN(YAML): link
// YAML: module {{*}}path="{{*}}second.yaml?yaml" displayPath={{*}}exports=[{name="a"{{*}}{name="b"{{*}}{name="default"

// RUN(COMPUTED): link
// COMPUTED: module {{*}}path="{{*}}third.toml?toml" displayPath={{*}}exports=[{name="a"{{*}}{name="b"{{*}}{name="default"

// RUN(JSON): link
// JSON: module {{*}}path="{{*}}fourth.json?json" displayPath={{*}}exports=[{name="default"

// RUN(UNTYPED): link
// UNTYPED: module {{*}}path="{{*}}fifth.toml" displayPath={{*}}exports=[{name="default"

// RUN(ALONE): link
// ALONE: module {{*}}path="{{*}}alone.toml" displayPath={{*}}exports=[{name="default"

// RUN(MEMBERS): lower
// MEMBERS-NOT: string="shared with a dynamic import"
// MEMBERS: = PropGet {{*}}key="mark"
// MEMBERS-NOT: key="sign"
// MEMBERS: = String string="reached by the static import alone"
// MEMBERS-NOT: key="sign"
// MEMBERS-NOT: string="shared with a dynamic import"

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
mark = "shared with a dynamic import"

// FILE: alone.toml
sign = "reached by the static import alone"
