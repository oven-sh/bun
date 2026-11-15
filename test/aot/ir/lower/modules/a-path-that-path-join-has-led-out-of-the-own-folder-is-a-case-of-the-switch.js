// `path.join(import.meta.dir, "../plugins", name + ".js")` takes the `..` away. In /$bunfs/root/main.js it makes /$bunfs/plugins/first.js, which does not begin with the own folder: nothing is cut off it,
// and it is no "./../plugins/first.js". The switch holds what the run makes too, from `import.meta.dir` and from `__dirname`, which is the folder of the source, and such a case leads where the spelling
// of the same candidate leads.
// ENTRY: one/two/app/main.js
// CWD: one/two/app

// RUN(BELOW): lower
// BELOW-LABEL: function {{*}}name="below"
// BELOW-NOT: Return
// BELOW: SwitchString {{*}}strings=["./plugins/first.js", "./plugins/second.js"] -> case [[first]](), case [[second]](), otherwise [[other]]()

// RUN(ONEUP): lower
// ONEUP-LABEL: function {{*}}name="oneUp"
// ONEUP-NOT: Return
// ONEUP: SwitchString {{*}}strings=["./../plugins/first.js", "./../plugins/second.js", "/$bunfs/plugins/first.js", "/$bunfs/plugins/second.js", "{{*}}/one/two/plugins/first.js", "{{*}}/one/two/plugins/second.js"] -> case [[first]](), case [[second]](), case [[first]](), case [[second]](), case [[first]](), case [[second]](), otherwise [[other]]()

// RUN(INONE): lower
// INONE-LABEL: function {{*}}name="inOneArgument"
// INONE-NOT: Return
// INONE: SwitchString {{*}}strings=["./../plugins/first.js", "./../plugins/second.js", "/$bunfs/plugins/first.js", "/$bunfs/plugins/second.js", "{{*}}/one/two/plugins/first.js", "{{*}}/one/two/plugins/second.js"] -> case

// RUN(SOURCE): lower
// SOURCE-LABEL: function {{*}}name="fromTheFolderOfTheSource"
// SOURCE-NOT: Return
// SOURCE: SwitchString {{*}}strings=["./../plugins/first.js", "./../plugins/second.js", "/$bunfs/plugins/first.js", "/$bunfs/plugins/second.js", "{{*}}/one/two/plugins/first.js", "{{*}}/one/two/plugins/second.js"] -> case

// RUN(TWOUP): lower
// TWOUP-LABEL: function {{*}}name="twoUp"
// TWOUP-NOT: Return
// TWOUP: SwitchString {{*}}strings=["./../../plugins/first.js", "/plugins/first.js", "{{*}}/one/plugins/first.js"] -> case [[first]](), case [[first]](), case [[first]](), otherwise [[other]]()

// /$bunfs/root-plugins/first.js begins as /$bunfs/root does, which is cut off it.
// RUN(SIBLING): lower
// SIBLING-LABEL: function {{*}}name="siblingThatBeginsAsTheOwnFolder"
// SIBLING-NOT: Return
// SIBLING: SwitchString {{*}}strings=["./../root-plugins/first.js", ".-plugins/first.js", "{{*}}/one/two/root-plugins/first.js"] -> case [[first]](), case [[first]](), case [[first]](), otherwise [[other]]()

// Below /$bunfs/root two candidates of one site leave one text, /plugins/first.js: nothing tells them apart, so it is no case and goes to the loader, which refuses it aloud.
// RUN(ONETEXT): lower
// ONETEXT-LABEL: function {{*}}name="oneText"
// ONETEXT-NOT: "/plugins/first.js"
// ONETEXT: SwitchString {{*}}strings=["./../../../plugins/first.js", "./../../plugins/first.js", "{{*}}/plugins/first.js", "{{*}}/one/plugins/first.js"] -> case [[far]](), case [[near]](), case [[far]](), case [[near]](), otherwise [[other]]()
// ONETEXT-NOT: "/plugins/first.js"
// ONETEXT: Return

// FILE: one/two/app/main.js
import path from "node:path";
export const below = name => import(path.join(import.meta.dir, "plugins", name + ".js"));
export const oneUp = name => import(path.join(import.meta.dir, "../plugins", name + ".js"));
export const inOneArgument = name => import(path.join(import.meta.dir, "../plugins/" + name + ".js"));
export const twoUp = name => import(path.resolve(import.meta.dir, "..", "..", "plugins", name + ".js"));
export const fromTheFolderOfTheSource = name => require(path.join(__dirname, "../plugins", name + ".js"));
export const siblingThatBeginsAsTheOwnFolder = name => import(path.join(import.meta.dir, "../root-plugins", name + ".js"));
export const oneText = (name, far) => import(path.join(import.meta.dir, far ? "../../../plugins" : "../../plugins", name + ".js"));

// FILE: one/two/app/plugins/first.js
export const said = "below: first";

// FILE: one/two/app/plugins/second.js
export const said = "below: second";

// FILE: one/two/plugins/first.js
export const said = "one up: first";

// FILE: one/two/plugins/second.js
export const said = "one up: second";

// FILE: one/two/root-plugins/first.js
export const said = "a sibling";

// FILE: one/plugins/first.js
export const said = "two up";

// FILE: plugins/first.js
export const said = "three up";
