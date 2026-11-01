// Objects whose structures do not fit in a full lookup table are still read and written correctly, and a full collection makes room for new structures.
// Flags: --aot-heat=none --aot-limit=LookupTableBases:256
// Env: JSC_aotCountsPath=/dev/null
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.js";
