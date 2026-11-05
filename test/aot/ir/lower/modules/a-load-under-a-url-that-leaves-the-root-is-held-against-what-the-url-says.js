// `new URL("../job.js", import.meta.url)` asks no resolver: it takes a folder away. In an executable the path of a module above the root spells each `..` as `_.._`, so what the URL says is another text
// than the URL of the module, which ResolveModule answers with. The text is held against both.
// ENTRY: one/two/app/main.js
// CWD: one/two/app

// RUN(BESIDE): lower
// BESIDE-LABEL: function {{*}}name="beside"
// BESIDE-NOT: = String string="file:
// BESIDE: = ImportModule module=m
// BESIDE-NOT: = String string="file:
// BESIDE: Return

// RUN(ONEUP): lower
// ONEUP-LABEL: function {{*}}name="oneUp"
// ONEUP-NOT: Return
// ONEUP: = ResolveModule module=[[job]] referrer={{*}} specifier="../job.js" [isURL]
// ONEUP-NOT: Return
// ONEUP: [[joined]] = String string="file:///$bunfs/job.js"
// ONEUP-NEXT: = StrictEq {{*}}, [[joined]]
// ONEUP-NOT: Return
// ONEUP: = ImportModule module=[[job]]

// RUN(TWOUP): lower
// TWOUP-LABEL: function {{*}}name="twoUp"
// TWOUP-NOT: Return
// TWOUP: [[joined]] = String string="file:///job.js"
// TWOUP-NEXT: = StrictEq {{*}}, [[joined]]

// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="object"
// OBJECT-NOT: Return
// OBJECT: [[joined]] = String string="file:///$bunfs/job.js"
// OBJECT-NEXT: = StrictEq {{*}}, [[joined]]

// RUN(RESOLVED): lower
// RESOLVED-LABEL: function {{*}}name="resolved"
// RESOLVED-NOT: Return
// RESOLVED: [[joined]] = String string="file:///$bunfs/job.js"
// RESOLVED-NEXT: = StrictEq {{*}}, [[joined]]

// RUN(PATH): lower
// PATH-LABEL: function {{*}}name="path"
// PATH-NOT: Return
// PATH: SwitchString {{*}} strings=[{{*}}"/$bunfs/job.js"]

// RUN(SHORT): lower
// SHORT-LABEL: function {{*}}name="withoutExtension"
// SHORT-NOT: Return
// SHORT: [[joined]] = String string="file:///$bunfs/root/beside"
// SHORT-NEXT: = StrictEq {{*}}, [[joined]]

// Two candidates of one site leave one rest: nothing tells them apart, so the text is held against neither and goes to the loader, which refuses it aloud.
// RUN(ONEREST): lower
// ONEREST-LABEL: function {{*}}name="oneRest"
// ONEREST-NOT: = String string="file:
// ONEREST: = ImportDynamic
// ONEREST-NOT: = String string="file:
// ONEREST: Return

// FILE: one/two/app/main.js
import { fileURLToPath } from "node:url";
export const oneRest = first => import(new URL(first ? "../../job.js" : "../../../job.js", import.meta.url).href);
export const beside = () => import(new URL("./beside.js", import.meta.url).href);
export const oneUp = () => import(new URL("../job.js", import.meta.url).href);
export const twoUp = () => import(new URL("../../job.js", import.meta.url).href);
export const object = () => import(new URL("../job.js", import.meta.url));
export const resolved = () => import(import.meta.resolve("../job.js"));
export const path = () => require(fileURLToPath(new URL("../job.js", import.meta.url)));
export const withoutExtension = () => import(new URL("./beside", import.meta.url).href);

// FILE: one/two/app/beside.js
export const said = "beside.js";

// FILE: one/two/job.js
export const said = "one up";

// FILE: one/job.js
export const said = "two up";

// FILE: job.js
export const said = "three up";
