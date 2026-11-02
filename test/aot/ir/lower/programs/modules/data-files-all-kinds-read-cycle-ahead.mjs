// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// STATISTIC: SourceFilesData = 10

// FILE: main.mjs
// caller.mjs runs ahead of reader.mjs, which imports it, and reads what reader.mjs imports from data files of every kind. All are there but the text and the Markdown, which are in their dead zones.
import "./reader.mjs";

// FILE: caller.mjs
import { readers } from "./reader.mjs";
for (const [name, read] of Object.entries(readers())) {
  try {
    console.log("caller:", name, read());
  } catch (error) {
    console.log("caller:", name, error.constructor.name);
  }
}

// FILE: data.bin
x
// FILE: data.css
body { color: red }
// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80 }, "list": [1, 2, 3] }

// FILE: data.json5
{ a: 5 }
// FILE: data.jsonc
// c
{ "a": 1, }
// FILE: data.md
# md
// FILE: data.toml
a = 2
// FILE: data.txt
text
// FILE: data.xml
<a>4</a>
// FILE: data.yaml
a: 3
// FILE: reader.mjs
import "./caller.mjs";
import json from "./data.json";
import jsonc from "./data.jsonc";
import json5 from "./data.json5";
import toml from "./data.toml";
import yaml from "./data.yaml";
import text from "./data.txt";
import file from "./data.bin" with { type: "file" };
import css from "./data.css";
import xml from "./data.xml";
import markdown from "./data.md";
import { a as named } from "./data.toml";
import * as all from "./data.yaml";
export function readers() {
  return {
    json: () => JSON.stringify(json),
    jsonc: () => JSON.stringify(jsonc),
    json5: () => JSON.stringify(json5),
    toml: () => JSON.stringify(toml),
    yaml: () => JSON.stringify(yaml),
    text: () => text,
    file: () => typeof file,
    css: () => JSON.stringify(css),
    xml: () => JSON.stringify(xml),
    markdown: () => markdown,
    named: () => named,
    all: () => Object.keys(all).join() + JSON.stringify(all.default),
  };
}
console.log("reader runs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
