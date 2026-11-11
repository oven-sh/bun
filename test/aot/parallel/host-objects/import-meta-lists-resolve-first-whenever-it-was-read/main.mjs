// The own names of import.meta come in one order, whether the module has read `resolve` before or not: a read that nothing uses is left out of a compiled program, and that must not show.
import emptyIf from "./empty-if.mjs";
import neverRead from "./never-read.mjs";
import unreadExport from "./unread-export.mjs";
import unusedConst from "./unused-const.mjs";

for (const [module, lists] of Object.entries({ unusedConst, unreadExport, emptyIf, neverRead })) console.log(module, JSON.stringify(lists));
