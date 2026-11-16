require("internal/desktop/native").prewarmIfPackaged();
require("internal/desktop/cover").begin();

const render = require("internal/desktop/render");
const system = require("internal/desktop/system");
const { app } = require("internal/desktop/app");
const { Window, useWindow } = require("internal/desktop/window");
const { Menu, MenuItem } = require("internal/desktop/menu");

const { nativeTheme } = system.api;

function subscribeToTheme(listener: () => void) {
  nativeTheme.on("updated", listener);
  return () => nativeTheme.off("updated", listener);
}

function useColorScheme() {
  return render.api.useSyncExternalStore(subscribeToTheme, () => (nativeTheme.shouldUseDarkColors ? "dark" : "light"));
}

export default {
  ...render.api,
  ...system.api,
  BaseWindow: Window,
  Menu,
  MenuItem,
  Window,
  app,
  dialog: require("internal/desktop/dialog"),
  useColorScheme,
  useWindow,
};
