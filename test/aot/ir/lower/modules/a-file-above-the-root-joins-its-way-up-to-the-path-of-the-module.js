// The files above the root of an executable lie in a mount of their own, /$bunfs/_.._, which stands for a folder above them all; each folder on the way down from there to the root is spelled `_.._` too.
// So what `path.join()` and `new URL()` make of the folder of such a file and a `..` is the path of what lies there on disk: a `..` takes a `_.._` away and leads up.
// ENTRY: one/two/app/main.js
// CWD: one/two/app

// RUN(PATHS): link
// PATHS: module {{*}} path="/$bunfs/root/texts/en.js"
// PATHS: module {{*}} path="/$bunfs/_.._/_.._/texts/en.js"
// PATHS: module {{*}} path="/$bunfs/_.._/_.._/_.._/loaders/loader.js"
// PATHS: module {{*}} path="/$bunfs/root/main.js"

// RUN(JOINED): link
// JOINED-LABEL: function {{*}}name="joined"
// JOINED-NOT: "/$bunfs/root/texts/en.js"
// JOINED: SwitchString {{*}}strings=["./../../texts/en.js", "/$bunfs/_.._/_.._/texts/en.js"] -> case [[en]](), case [[en]](), otherwise [[other]]()
// JOINED-NOT: "/$bunfs/root/texts/en.js"
// JOINED: Return

// FILE: one/two/app/main.js
import "./texts/en.js";
export { joined } from "../loaders/loader.js";

// FILE: one/two/loaders/loader.js
import path from "node:path";
export const joined = name => import(path.join(import.meta.dirname, "../../texts", name + ".js"));

// FILE: one/texts/en.js
export const said = "one/texts/en.js";

// FILE: one/two/app/texts/en.js
export const said = "one/two/app/texts/en.js";
