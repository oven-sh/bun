require("internal/desktop/native").prewarmIfPackaged();

const { window, document } = require("internal/desktop/host").installGlobals();

export default { window, document };
