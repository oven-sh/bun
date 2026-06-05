// Menu / MenuItem — Electron-compatible menu data model.
//
// The data model, template building, click dispatch, and application-menu
// registry match Electron. Native rendering (OS menu bar / context menus)
// is not wired up yet; menus are fully usable programmatically.

import type { BrowserWindow } from "./browser-window";

export type MenuItemType = "normal" | "separator" | "submenu" | "checkbox" | "radio";

export interface MenuItemConstructorOptions {
  click?: (menuItem: MenuItem, browserWindow: BrowserWindow | undefined, event: unknown) => void;
  role?: string;
  type?: MenuItemType;
  label?: string;
  sublabel?: string;
  toolTip?: string;
  accelerator?: string;
  id?: string;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  submenu?: MenuItemConstructorOptions[] | Menu;
  extra?: unknown;
  [key: string]: unknown;
}

const ROLE_LABELS: Record<string, string> = {
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pasteandmatchstyle: "Paste and Match Style",
  selectall: "Select All",
  delete: "Delete",
  minimize: "Minimize",
  close: "Close Window",
  quit: "Quit",
  reload: "Reload",
  forcereload: "Force Reload",
  toggledevtools: "Toggle Developer Tools",
  togglefullscreen: "Toggle Full Screen",
  resetzoom: "Actual Size",
  zoomin: "Zoom In",
  zoomout: "Zoom Out",
  about: "About",
  help: "Help",
  window: "Window",
  services: "Services",
};

let nextCommandId = 1;

export class MenuItem {
  readonly commandId: number;
  type: MenuItemType;
  label: string;
  sublabel: string;
  toolTip: string;
  accelerator?: string;
  id?: string;
  enabled: boolean;
  visible: boolean;
  checked: boolean;
  role?: string;
  submenu: Menu | null = null;
  menu: Menu | null = null;
  readonly click: (event?: unknown, focusedWindow?: BrowserWindow, focusedWebContents?: unknown) => void;

  constructor(options: MenuItemConstructorOptions) {
    if (options == null || typeof options !== "object") {
      throw new TypeError("Options must be an object");
    }
    this.commandId = nextCommandId++;
    this.role = options.role;

    if (options.submenu) {
      this.submenu = Array.isArray(options.submenu)
        ? Menu.buildFromTemplate(options.submenu)
        : options.submenu;
    }
    this.type = options.type ?? (this.submenu ? "submenu" : "normal");
    if (this.type === "submenu" && !this.submenu) {
      this.submenu = new Menu();
    }

    this.label =
      options.label ?? (this.role ? (ROLE_LABELS[this.role.toLowerCase()] ?? this.role) : "");
    this.sublabel = options.sublabel ?? "";
    this.toolTip = options.toolTip ?? "";
    this.accelerator = options.accelerator;
    this.id = options.id;
    this.enabled = options.enabled ?? true;
    this.visible = options.visible ?? true;
    this.checked = options.checked ?? false;

    // Copy extra/unknown fields like Electron does (allows attaching data).
    for (const key of Object.keys(options)) {
      if (!(key in this)) {
        (this as Record<string, unknown>)[key] = options[key];
      }
    }

    const userClick = options.click;
    this.click = (event?: unknown, focusedWindow?: BrowserWindow, focusedWebContents?: unknown) => {
      if (this.type === "checkbox") this.checked = !this.checked;
      if (this.type === "radio" && this.menu) this.menu._selectRadio(this);
      userClick?.(this, focusedWindow, event);
    };
  }
}

let applicationMenu: Menu | null = null;

export class Menu {
  readonly items: MenuItem[] = [];

  static buildFromTemplate(template: MenuItemConstructorOptions[]): Menu {
    if (!Array.isArray(template)) {
      throw new TypeError("Invalid template for Menu: Menu template must be an array");
    }
    const menu = new Menu();
    for (const options of template) {
      menu.append(options instanceof MenuItem ? options : new MenuItem(options));
    }
    return menu;
  }

  static setApplicationMenu(menu: Menu | null): void {
    applicationMenu = menu;
  }

  static getApplicationMenu(): Menu | null {
    return applicationMenu;
  }

  append(item: MenuItem): void {
    this.insert(this.items.length, item);
  }

  insert(pos: number, item: MenuItem): void {
    if (!(item instanceof MenuItem)) {
      throw new TypeError("Invalid item");
    }
    if (pos < 0 || pos > this.items.length) {
      throw new RangeError(`Position ${pos} cannot be greater than the total MenuItem count`);
    }
    item.menu = this;
    this.items.splice(pos, 0, item);
  }

  getMenuItemById(id: string): MenuItem | null {
    for (const item of this.items) {
      if (item.id === id) return item;
      if (item.submenu) {
        const found = item.submenu.getMenuItemById(id);
        if (found) return found;
      }
    }
    return null;
  }

  popup(_options?: { window?: BrowserWindow; x?: number; y?: number }): void {
    // Native context-menu rendering is not implemented yet.
  }

  closePopup(): void {}

  /** @internal Radio group handling: checking one unchecks its neighbors. */
  _selectRadio(selected: MenuItem): void {
    const index = this.items.indexOf(selected);
    if (index < 0) return;
    selected.checked = true;
    // A radio group extends to the nearest separator on each side.
    for (let i = index - 1; i >= 0 && this.items[i].type === "radio"; i--) {
      this.items[i].checked = false;
    }
    for (let i = index + 1; i < this.items.length && this.items[i].type === "radio"; i++) {
      this.items[i].checked = false;
    }
  }
}
