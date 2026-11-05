// one/loaders/load.js lies one folder above the entry point, in /$bunfs/root/_.._/loaders in the executable, and loads from texts/, two folders above itself. `path.join()` and `new URL()` take the `_.._` away
// where the program goes further up: /$bunfs/root/texts is left, which is the folder beside the entry point. Where such a text goes to the loader by name it is put back under /$bunfs/root/_.._/_.._/texts.
// ENTRY: one/app/main.js
// CWD: one/app

// An import() with options asks the loader.
// RUN(TYPED): link
// TYPED-LABEL: function {{*}}name="withOptions"
// TYPED-NOT: ImportDynamic
// TYPED: = String string="/$bunfs/root/_.._/_.._/texts/"
// TYPED-NOT: ImportDynamic
// TYPED: = String string="/$bunfs/root/texts/"
// TYPED-NOT: ImportDynamic
// TYPED: [[folder]] = String string="/$bunfs/root/_.._/_.._/texts"
// TYPED-NEXT: [[put]] = Strcat [[folder]], {{*}}
// TYPED-NEXT: Jump -> next [[asks]]([[put]])
// TYPED-NEXT: [[asks]]([[name]]):
// TYPED-NEXT: = ImportDynamic [[name]], {{*}}

// A name that is none of the files that the build has found.
// RUN(JOINED): link
// JOINED-LABEL: function {{*}}name="joined"
// JOINED: SwitchString {{*}} strings=["./../../texts/en.json", "/$bunfs/root/texts/en.json"]
// JOINED-NOT: ImportDynamic
// JOINED: [[folder]] = String string="/$bunfs/root/_.._/_.._/texts"
// JOINED-NEXT: [[put]] = Strcat [[folder]], {{*}}
// JOINED-NEXT: Jump -> next [[asks]]([[put]])
// JOINED-NEXT: [[asks]]([[name]]):
// JOINED-NEXT: = ImportDynamic [[name]] referrer

// RUN(REQUIRED): link
// REQUIRED-LABEL: function {{*}}name="required"
// REQUIRED-NOT: RequireDynamic
// REQUIRED: [[folder]] = String string="/$bunfs/root/_.._/_.._/texts"
// REQUIRED-NEXT: [[put]] = Strcat [[folder]], {{*}}
// REQUIRED-NEXT: Jump -> next [[asks]]([[put]])
// REQUIRED-NEXT: [[asks]]([[name]]):
// REQUIRED-NEXT: = RequireDynamic [[name]] referrer

// RUN(BYURL): link
// BYURL-LABEL: function {{*}}name="underUrl"
// BYURL-NOT: ImportDynamic
// BYURL: = String string="file:///$bunfs/root/texts/"
// BYURL-NOT: ImportDynamic
// BYURL: [[folder]] = String string="file:///$bunfs/root/_.._/_.._/texts"
// BYURL-NEXT: [[put]] = Strcat [[folder]], {{*}}
// BYURL-NEXT: Jump -> next [[asks]]([[put]])
// BYURL-NEXT: [[asks]]([[name]]):
// BYURL-NEXT: = ImportDynamic [[name]] referrer

// RUN(RESOLVED): link
// RESOLVED-LABEL: function {{*}}name="resolved"
// RESOLVED-NOT: ResolveDynamic
// RESOLVED: [[folder]] = String string="/$bunfs/root/_.._/_.._/texts"
// RESOLVED-NEXT: [[put]] = Strcat [[folder]], {{*}}
// RESOLVED-NEXT: Jump -> next [[asks]]([[put]])
// RESOLVED-NEXT: [[asks]]([[name]]):
// RESOLVED-NEXT: = ResolveDynamic [[name]] referrer

// One folder up takes no `_.._` away.
// RUN(ONEUP): link
// ONEUP-LABEL: function {{*}}name="oneUp"
// ONEUP: [[path]] = Call {{*}} calleeName="path.join"
// ONEUP: = ImportDynamic [[path]] referrer

// Nothing of a way up is written here: a whole path that is handed in is right as it stands, and so is what `path.relative()` has made of two paths of the executable.
// RUN(HANDED): link
// HANDED-LABEL: function {{*}}name="handedIn"
// HANDED: [[path]] = Call {{*}} calleeName="path.resolve"
// HANDED: = ImportDynamic [[path]] referrer

// FILE: one/app/main.js
import "./texts/en.json";
export * from "../loaders/load.js";

// FILE: one/app/texts/en.json
{ "said": "beside the entry point" }

// FILE: one/loaders/load.js
import path from "node:path";
export const withOptions = name => import(path.join(import.meta.dirname, "../../texts", name + ".json"), { with: { type: "json" } });
export const joined = name => import(path.join(import.meta.dirname, "../../texts", name + ".json"));
export const required = name => require(path.join(import.meta.dirname, "../../texts", name + ".json"));
export const underUrl = name => import(new URL(`../../texts/${name}.json`, import.meta.url).href);
export const resolved = name => import.meta.resolve(path.join(import.meta.dirname, "../../texts", name + ".json"));
export const oneUp = name => import(path.join(import.meta.dirname, "../others", name + ".json"));
export const handedIn = rest => import(path.resolve(import.meta.dirname, rest));

// FILE: one/others/en.json
{ "said": "beside the loaders" }

// FILE: texts/en.json
{ "said": "two folders above the loaders" }
