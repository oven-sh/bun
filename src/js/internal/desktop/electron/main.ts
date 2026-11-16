const createRealm = $newCppFunction("DesktopRealm.cpp", "jsFunctionCreateDesktopRealm", 0);

function warnAboutRejections() {
  process.on("unhandledRejection", (reason: any) => {
    if (process.listenerCount("unhandledRejection") > 1) return;
    process.emitWarning(
      reason instanceof Error ? (reason.stack ?? String(reason)) : Bun.inspect(reason),
      "UnhandledPromiseRejectionWarning",
    );
  });
}

function outliveExceptions(dialog: { showErrorBox(title: string, content: string): void }) {
  process.on("uncaughtException", (error: any) => {
    if (process.listenerCount("uncaughtException") > 1) return;
    const text = `Uncaught Exception:\n${error instanceof Error ? error.stack : Bun.inspect(error)}`;
    setImmediate(() => {
      try {
        dialog.showErrorBox("A JavaScript error occurred in the main process", text);
      } catch {
        console.error(text);
      }
    });
  });
}

function mainProcess() {
  const path = require("node:path");
  const packaged: string | null = require("internal/desktop/native").resourcesPath();
  if (process.env.ELECTRON_RUN_AS_NODE && packaged !== null) {
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    process.execve(process.execPath, [process.execPath, ...process.argv.slice(2)], { ...env, BUN_BE_BUN: "1" });
  }
  require("internal/desktop/cover").begin();
  if (packaged !== null) process.argv.splice(0, 2, process.execPath);
  Object.assign(process, {
    type: "browser",
    resourcesPath: packaged ?? path.join(path.dirname(process.execPath), "resources"),
    ...(packaged === null && { defaultApp: true }),
  });

  const { app, startSoon } = require("internal/desktop/electron/app");
  const system = require("internal/desktop/electron/system");
  const { MessageChannelMain, ipcMain } = require("internal/desktop/electron/ipc");
  const { netLog, protocol, session } = require("internal/desktop/electron/session");
  const { webContents, webFrameMain } = require("internal/desktop/electron/web_contents");
  const { target: _, ...views } = require("internal/desktop/electron/views");
  Object.assign(process, system.processMethods);
  outliveExceptions(system.exports.dialog);
  setImmediate(startSoon);
  return {
    ...system.exports,
    ...views,
    MessageChannelMain,
    app,
    ipcMain,
    net: require("internal/desktop/electron/net").net,
    netLog,
    protocol,
    session,
    utilityProcess: require("internal/desktop/electron/utility").utilityProcess,
    webContents,
    webFrameMain,
  };
}

function load() {
  const isMain = Bun.isMainThread;
  if (!isMain && require("internal/desktop/electron/worker_thread").enter(createRealm)) return {};
  const { versions } = process;
  $putByValDirect(versions, "chrome", "156.0.0.0");
  $putByValDirect(versions, "electron", "45.0.0");
  if (isMain) warnAboutRejections();
  const electron = isMain ? (require("internal/desktop/electron/utility").enter() ?? mainProcess()) : {};
  require("internal/desktop/electron/aliases")(electron);
  return electron;
}

export default load();
