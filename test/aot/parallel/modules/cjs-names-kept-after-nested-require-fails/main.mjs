// Flags: --external ./absent.mjs
// file.cjs requires an ES module that imports file.cjs back and also imports a file that cannot be found. The loader takes the names of file.cjs when that load
// reaches it, before `v` is exported, and keeps them though the load fails. A later importer of `v` is refused.
import "./start.cjs";
