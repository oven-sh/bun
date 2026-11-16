const EventEmitter = require("node:events");
const native = require("internal/desktop/native");
const accelerator = require("internal/desktop/accelerator");
const { app, Event } = require("internal/desktop/app");
const { allocateSurfaceId, surfaces, trap } = require("internal/desktop/surfaces");
const { Window, kMenus } = require("internal/desktop/window");

const isMac = process.platform === "darwin";

type Role = { label: string; accelerator?: string; run?: (window: any) => void; submenu?: object[] };
const separator = { type: "separator" };
const edit = (label: string, accelerator: string, method: string): Role => ({
  label,
  accelerator,
  run: window => window?.[method](),
});
const zoom = (by: number) => (window: any) =>
  window?.setZoomFactor(Math.min(Math.max(window.getZoomFactor() * by, 0.3), 5));

function role(name: string): Role | undefined {
  switch (name.toLowerCase()) {
    case "undo":
      return edit("Undo", "CmdOrCtrl+Z", "undo");
    case "redo":
      return edit("Redo", process.platform === "win32" ? "Ctrl+Y" : "CmdOrCtrl+Shift+Z", "redo");
    case "cut":
      return edit("Cut", "CmdOrCtrl+X", "cut");
    case "copy":
      return edit("Copy", "CmdOrCtrl+C", "copy");
    case "paste":
      return edit("Paste", "CmdOrCtrl+V", "paste");
    case "pasteandmatchstyle":
      return edit("Paste and Match Style", isMac ? "Cmd+Alt+Shift+V" : "Ctrl+Shift+V", "pasteAndMatchStyle");
    case "selectall":
      return edit("Select All", "CmdOrCtrl+A", "selectAll");
    case "close":
      return edit(isMac ? "Close Window" : "Close", "CmdOrCtrl+W", "close");
    case "minimize":
      return edit("Minimize", "CmdOrCtrl+M", "minimize");
    case "zoom":
      return { label: "Zoom", run: window => (window?.isMaximized() ? window.unmaximize() : window?.maximize()) };
    case "togglefullscreen":
      return {
        label: "Toggle Full Screen",
        accelerator: isMac ? "Ctrl+Cmd+F" : "F11",
        run: window => window?.setFullScreen(!window.isFullScreen()),
      };
    case "resetzoom":
      return { label: "Actual Size", accelerator: "CmdOrCtrl+0", run: window => window?.setZoomFactor(1) };
    case "zoomin":
      return { label: "Zoom In", accelerator: "CmdOrCtrl+=", run: zoom(1.1) };
    case "zoomout":
      return { label: "Zoom Out", accelerator: "CmdOrCtrl+-", run: zoom(1 / 1.1) };
    case "quit":
      return {
        label: isMac ? `Quit ${app.name}` : process.platform === "win32" ? "Exit" : "Quit",
        accelerator: process.platform === "win32" ? undefined : "CmdOrCtrl+Q",
        run: () => app.quit(),
      };
    case "about":
      return { label: `About ${app.name}`, run: () => app.showAboutPanel() };
    case "hide":
      return { label: `Hide ${app.name}`, accelerator: "Cmd+H", run: () => app.hide() };
    case "hideothers":
      return { label: "Hide Others", accelerator: "Cmd+Alt+H", run: () => native.send("hideOthers") };
    case "unhide":
      return { label: "Show All", run: () => native.send("unhide") };
    case "front":
      return { label: "Bring All to Front", run: () => app.focus({ steal: true }) };
    case "services":
      return { label: "Services" };
    case "window":
      return { label: "Window" };
    case "help":
      return { label: "Help" };
    case "appmenu":
      return {
        label: app.name,
        submenu: [
          { role: "about" },
          separator,
          { role: "services" },
          separator,
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          separator,
          { role: "quit" },
        ],
      };
    case "filemenu":
      return { label: "File", submenu: [{ role: isMac ? "close" : "quit" }] };
    case "editmenu":
      return {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          separator,
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          separator,
          { role: "selectAll" },
        ],
      };
    case "viewmenu":
      return {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          separator,
          { role: "togglefullscreen" },
        ],
      };
    case "windowmenu":
      return {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          ...(isMac ? [separator, { role: "front" }] : [{ role: "close" }]),
        ],
      };
  }
}

/** The roles that menu.rs knows. */
const nativeRoles = {
  __proto__: null,
  undo: "undo",
  redo: "redo",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  selectall: "selectAll",
  services: "services",
  window: "window",
  windowmenu: "window",
  help: "help",
  close: "close",
  minimize: "minimize",
};

let nextCommandId = 1;
const kActivate = Symbol("kActivate");

class MenuItem {
  commandId = nextCommandId++;
  id: string | undefined;
  type: string;
  role: string | undefined;
  accelerator: string | undefined;
  icon: any;
  sublabel: string;
  toolTip: string;
  submenu: Menu | undefined;
  menu: Menu | null = null;
  click: ((item: MenuItem, window: any, event: object) => void) | undefined;
  #label: string;
  #enabled: boolean;
  #visible: boolean;
  #checked: boolean;

  constructor(options: Record<string, any>) {
    const defaults = options.role === undefined ? undefined : role(options.role);
    const optionsRole = options.role;
    if (optionsRole !== undefined && !defaults) {
      throw $ERR_INVALID_ARG_VALUE("role", optionsRole, "is not a supported role");
    }
    const submenu = options.submenu ?? defaults?.submenu;
    this.id = options.id;
    this.role = options.role;
    this.submenu = $isArray(submenu) ? Menu.buildFromTemplate(submenu) : submenu;
    this.type = options.type ?? (this.submenu ? "submenu" : "normal");
    this.accelerator = options.accelerator ?? defaults?.accelerator;
    const ownAccelerator = this.accelerator;
    if (ownAccelerator) accelerator.parse(ownAccelerator);
    this.icon = options.icon;
    this.sublabel = options.sublabel ?? "";
    this.toolTip = options.toolTip ?? "";
    this.click = options.click;
    this.#label = options.label ?? defaults?.label ?? "";
    this.#enabled = options.enabled !== false;
    this.#visible = options.visible !== false;
    this.#checked = !!options.checked;
  }

  get label() {
    return this.#label;
  }

  set label(label) {
    this.#label = String(label);
    menusChanged();
  }

  get enabled() {
    return this.#enabled;
  }

  set enabled(enabled) {
    this.#enabled = !!enabled;
    menusChanged();
  }

  get visible() {
    return this.#visible;
  }

  set visible(visible) {
    this.#visible = !!visible;
    menusChanged();
  }

  get checked() {
    return this.#checked;
  }

  set checked(checked) {
    this.#checked = !!checked;
    const { menu } = this;
    if (checked && this.type === "radio" && menu) {
      const { items } = menu;
      const index = items.indexOf(this);
      for (const step of [-1, 1]) {
        for (let i = index + step; items[i] && items[i].type !== "separator"; i += step) {
          if (items[i].type === "radio") items[i].#checked = false;
        }
      }
    }
    menusChanged();
  }

  [kActivate](window: any, modifiers?: number) {
    if (!this.#enabled) return;
    if (this.type === "checkbox") this.checked = !this.#checked;
    else if (this.type === "radio") this.checked = true;
    const ownRole = this.role;
    if (ownRole !== undefined) role(ownRole)!.run?.(window);
    const event = Object.assign(new Event(), {
      triggeredByAccelerator: modifiers !== undefined,
      shiftKey: !!(modifiers! & accelerator.SHIFT),
      ctrlKey: !!(modifiers! & accelerator.CONTROL),
      altKey: !!(modifiers! & accelerator.ALT),
      metaKey: !!(modifiers! & accelerator.META),
    });
    this.click?.(this, window ?? undefined, event);
  }
}

let applicationMenu: Menu | null = null;
let applicationMenuWasSet = false;
const windowMenus = new Map<object, Menu | null>();
const attached = new Map<unknown, { menu: Menu; send: (template: object[] | null) => void }>();
let changeQueued = false;

class Menu extends EventEmitter {
  items: MenuItem[] = [];
  #close: (() => void) | undefined;

  static buildFromTemplate(template: (Record<string, any> | MenuItem)[]) {
    const menu = new Menu();
    for (const item of template) menu.append(item instanceof MenuItem ? item : new MenuItem(item));
    return menu;
  }

  static getApplicationMenu() {
    return applicationMenu;
  }

  static setApplicationMenu(menu: Menu | null) {
    applicationMenu = menu;
    applicationMenuWasSet = true;
    attachActiveMenu();
    Window.menusChanged();
  }

  append(item: MenuItem) {
    this.insert(this.items.length, item);
  }

  insert(position: number, item: MenuItem) {
    if (!(item instanceof MenuItem)) throw $ERR_INVALID_ARG_TYPE("menuItem", "MenuItem", item);
    item.menu = this;
    this.items.splice(position, 0, item);
    menusChanged();
  }

  getMenuItemById(id: string) {
    return findItem(this, item => item.id === id) ?? null;
  }

  popup(options: { window?: any; x?: number; y?: number; positioningItem?: number; callback?: () => void } = {}) {
    const window = options.window ?? Window.getFocusedWindow() ?? Window.getAllWindows()[0];
    if (!window) throw new Error("A menu needs a window to pop up in");
    this.closePopup();
    const mouse = native.ask("window.mouse", { id: window.id }) ?? [0, 0];
    const close = (this.#close = () => {
      this.#close = undefined;
      window.off("closed", close);
      remove();
      this.emit("menu-will-close", new Event());
      options.callback?.();
    });
    window.once("closed", close);
    this.emit("menu-will-show", new Event());
    const top = window.getContentBounds().y - window.getBounds().y;
    const [x, y] = [options.x ?? mouse[0], options.y === undefined ? mouse[1] : options.y + top];
    const usesPlatform = isMac && !native.options.headless;
    const remove = usesPlatform
      ? popUpNatively(this, { window: window.id, x, y, positioningItem: options.positioningItem }, close)
      : window[kMenus].popUp(this, x, y, close);
  }

  closePopup() {
    this.#close?.();
  }
}

function findItem(menu: Menu, test: (item: MenuItem) => boolean): MenuItem | undefined {
  for (const item of menu.items) {
    const found = test(item) ? item : item.submenu && findItem(item.submenu, test);
    if (found) return found;
  }
}

/** Without separators that separate nothing. */
function visibleItems(menu: Menu) {
  const items: MenuItem[] = [];
  for (const item of menu.items) {
    if (!item.visible || (item.role === "services" && !isMac)) continue;
    if (item.type !== "separator" || (items.length > 0 && items.at(-1)!.type !== "separator")) items.push(item);
  }
  if (items.at(-1)?.type === "separator") items.pop();
  return items;
}

const withoutMnemonic = (label: string) => label.replace(/&(&?)/g, "$1");

function serialize(menu: Menu): object[] {
  return visibleItems(menu).map(item => ({
    id: item.commandId,
    label: withoutMnemonic(item.label),
    type: item.type,
    role: item.click ? undefined : nativeRoles[item.role?.toLowerCase() ?? ""],
    enabled: item.enabled,
    checked: item.checked,
    submenu: item.submenu && serialize(item.submenu),
    accelerator: item.accelerator ? accelerator.parse(item.accelerator) : undefined,
    sublabel: item.sublabel,
    toolTip: item.toolTip,
    icon: isMac && item.icon ? serializeIcon(require("internal/desktop/system").toImage(item.icon)) : undefined,
  }));
}

function serializeIcon(image: any) {
  if (image.isEmpty()) return undefined;
  return {
    blob: native.putBlob(require("internal/desktop/system").sharpestBytes(image)),
    template: image.isTemplateImage(),
    ...image.getSize(),
  };
}

let nativePopup: Menu | null = null;

function popUpUnderTray(menu: Menu, tray: number) {
  menu.emit("menu-will-show", new Event());
  return popUpNatively(menu, { tray }, () => menu.emit("menu-will-close", new Event()), "popUpTrayMenu");
}

function popUpNatively(menu: Menu, at: object, close: () => void, command = "popUpMenu") {
  let isOpen = true;
  const closed = () => {
    if (!isOpen) return;
    isOpen = false;
    close();
  };
  nativePopup = menu;
  native.request(command, { ...at, items: serialize(menu) }).then(closed, closed);
  return () => {
    if (isOpen) native.send("closePopUpMenu");
    isOpen = false;
  };
}

/** Keeps a menu of the platform the same as `menu`. */
function attach(slot: unknown, menu: Menu | null, send?: (template: object[] | null) => void) {
  if (menu) attached.$set(slot, { menu, send: send! });
  else attached.$delete(slot);
  send?.(menu && serialize(menu));
}

function menusChanged() {
  if (changeQueued || !native.isStarted()) return;
  changeQueued = true;
  queueMicrotask(() => {
    changeQueued = false;
    for (const { menu, send } of attached.values()) send(serialize(menu));
    Window.menusChanged();
  });
}

function attachActiveMenu() {
  if (!isMac) return;
  const own = windowMenus.$get(Window.getFocusedWindow()!);
  const menu = own === undefined ? applicationMenu : own;
  attach("application", menu, template => native.send("applicationMenu", template ?? []));
}

function setWindowMenu(window: object, menu: Menu | null | undefined) {
  if (menu === undefined) windowMenus.$delete(window);
  else windowMenus.$set(window, menu);
  attachActiveMenu();
}

function setDefaultApplicationMenu() {
  if (applicationMenuWasSet) return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(["appMenu", "fileMenu", "editMenu", "viewMenu", "windowMenu"].map(role => ({ role }))),
  );
}

app.on("window-focus", () => windowMenus.size > 0 && attachActiveMenu());

native.handlers.menu = event => {
  const chosen = nativePopup && findItem(nativePopup, item => item.commandId === event.id);
  if (chosen) return chosen[kActivate](Window.getFocusedWindow());
  for (const { menu } of attached.values()) {
    const item = findItem(menu, item => item.commandId === event.id);
    if (!item) continue;
    const modifiers = event.byKey && item.accelerator ? accelerator.parse(item.accelerator)[1] : undefined;
    return item[kActivate](Window.getFocusedWindow(), modifiers);
  }
};

function activateByKey(menu: Menu | null, window: object, event: { m: number }): boolean {
  const found = findByKey(menu, event);
  found?.[kActivate](window, event.m);
  return !!found;
}

/** For a page that answers later whether it has handled the key. It is not asked about the ways out of it. */
function deferByKey(menu: Menu | null, window: object, event: { m: number }) {
  const found = findByKey(menu, event);
  if (!found) return;
  return {
    isReserved: /^(?:quit|close|hide.*|minimize)$/i.test(found.role ?? ""),
    run: () => found[kActivate](window, event.m),
  };
}

function findByKey(menu: Menu | null, { key, code, m }: any) {
  const bits = m & 15;
  const names = [key, code.replace(/^(?:Key|Digit)/, "")].map(accelerator.keyName);
  return (
    menu &&
    findItem(menu, item => {
      if (!item.accelerator || !item.enabled || (item as any).registerAccelerator === false) return false;
      const [wanted, modifiers] = accelerator.parse(item.accelerator);
      const isShifted = wanted === key && !/[a-z]/i.test(key) && modifiers === (bits & ~accelerator.SHIFT);
      return isShifted || (modifiers === bits && names.includes(wanted));
    })
  );
}

const style = `
:root{color-scheme:light dark;font:14px system-ui;cursor:default;user-select:none;overflow:hidden;
  --line:light-dark(#0002,#fff2);color:light-dark(#2e3436,#eeeeec)}
body{margin:0}
[role=menubar]{display:flex;align-items:center;box-sizing:border-box;height:var(--bar);padding:0 4px;font-size:13px;
  background:light-dark(#f6f6f6,#2b2b2b);border-bottom:1px solid var(--line)}
[role=menubar]>*{padding:2px 8px;border-radius:4px}
[role=menubar]>:hover{background:#8883}
[role=menubar]>[aria-expanded=true]{background:#8884}
[role=menu]{display:grid;grid-template-columns:auto 1fr auto;position:fixed;width:max-content;max-width:min(800px,100vw);max-height:100vh;overflow-y:auto;
  box-sizing:border-box;padding:4px 0;background:light-dark(#fff,#2f2f2f);border-radius:6px;
  box-shadow:0 0 0 1px var(--line),0 4px 12px #0003}
[role=menu]>*{grid-column:1/-1}
[role=menu]>div{display:grid;grid-template-columns:subgrid;align-items:center;min-height:32px;padding:0 20px;white-space:nowrap}
[role=menu]>.selected{color:AccentColorText;background:AccentColor}
[aria-disabled=true]{opacity:.5}
[role=menu]>[role=heading]{opacity:.7;font-size:12px;font-weight:600}
hr{margin:8px 0;border:0;border-top:1px solid var(--line)}
b{display:flex;width:28px}
span{grid-column:2;min-width:0;overflow:hidden;text-overflow:ellipsis}
small{display:block;opacity:.7;font-size:12px;padding-bottom:4px}
kbd{display:flex;justify-self:end;margin-left:8px;opacity:.6;font:inherit}
.selected kbd,kbd:has(svg){opacity:1}
kbd:has(svg){margin:0 -4px 0 20px}
svg,img{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.4}`;

const icons = {
  checkbox: '<svg viewBox="0 0 16 16"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>',
  radio: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" stroke-width="4"/></svg>',
  submenu: '<svg viewBox="0 0 16 16"><path d="m6 4.5 3.5 3.5-3.5 3.5"/></svg>',
};

const mnemonicOf = (label: string) => (/&([^&])/.exec(label.replaceAll("&&", ""))?.[1] ?? label[0])?.toLowerCase();
const ariaRoles = { __proto__: null, checkbox: "menuitemcheckbox", radio: "menuitemradio" };

type Panel = { items: MenuItem[]; element: any; selected: number };

/** A surface above the content of a window. It is as large as the menu bar, or as the window while a menu is open. */
class Menus {
  #window: any;
  #barHeight: number;
  #surface = allocateSurfaceId();
  #page: any;
  #bar: MenuItem[] = [];
  /** Which of `#bar` is open. */
  #open = -1;
  #panels: Panel[] = [];
  #close: (() => void) | null = null;
  #dismiss = () => this.#close?.();

  constructor(window: any, barHeight: number) {
    const id = this.#surface;
    const { nativeTheme } = require("internal/desktop/system").api;
    const environment = () => ({ dark: nativeTheme.shouldUseDarkColors, transparent: true });
    this.#window = window;
    this.#barHeight = barHeight;
    native.send("surface.create", { id, focusable: false });
    this.layOut();
    this.raise();
    this.#page = require("internal/desktop/dom/page").createPage({ native, surface: id, environment });
    this.#page.parseHTML(
      `<!doctype html><style>${style}:root{--bar:${barHeight}px}</style><div role=menubar style=display:none>`,
    );
    this.#page.document.onmousedown = event => event.target.closest("[role^=menui]") === null && this.#close?.();
    surfaces.$set(id, this.#page.handleEvent);
    window.on("blur", this.#dismiss);
    window.on("resize", this.#dismiss);
  }

  raise() {
    native.send("surface.attach", { id: this.#surface, window: this.#window.id });
  }

  layOut() {
    const isOpen = this.#close !== null;
    const bounds = isOpen ? null : { x: 0, y: 0, width: this.#window.getBounds().width, height: this.#barHeight };
    native.send("surface.set", { id: this.#surface, bounds, visible: isOpen || this.#bar.length > 0 });
  }

  environmentChanged() {
    this.#page.environmentChanged();
  }

  dispose() {
    this.#close?.();
    this.#page.dispose();
    surfaces.$delete(this.#surface);
    native.destroySurface(this.#surface);
  }

  #create(tag: string, text: string, parent: any) {
    const element = parent.appendChild(this.#page.document.createElement(tag));
    element.textContent = text;
    return element;
  }

  setBar(menu: Menu | null) {
    const bar = this.#page.document.body.firstChild;
    this.#bar = menu ? visibleItems(menu).filter(item => item.submenu) : [];
    bar.style.display = menu ? "" : "none";
    bar.replaceChildren();
    this.#bar.forEach((item, index) => {
      const title = this.#create("div", withoutMnemonic(item.label), bar);
      title.role = "menuitem";
      title.ariaExpanded = String(index === this.#open);
      title.ariaDisabled = String(!item.enabled);
      title.onmousedown = () => (this.#open === index ? this.#close!() : this.#openBar(index));
      title.onmouseenter = () => this.#open >= 0 && this.#open !== index && this.#openBar(index);
    });
    this.layOut();
  }

  #openBar(index: number) {
    const title = this.#page.document.body.firstChild.children[index];
    const menu = this.#bar[index].submenu!;
    if (!this.#bar[index].enabled) return;
    this.#close?.();
    this.#open = index;
    title.ariaExpanded = "true";
    menu.emit("menu-will-show", new Event());
    const remove = this.popUp(menu, title.getBoundingClientRect().left, this.#barHeight, () => {
      remove();
      this.#open = -1;
      for (const each of this.#page.document.body.firstChild.children) each.ariaExpanded = "false";
      menu.emit("menu-will-close", new Event());
    });
  }

  /** `close` has to call what this returns. */
  popUp(menu: Menu, x: number, y: number, close: () => void) {
    this.#close?.();
    this.#close = close;
    trap.keys = event => event.e === "down" && this.#handleKey(event.key as string);
    this.layOut();
    this.#page.attach(this.#surface);
    this.#addPanel(menu, x, x, y, y);
    return () => {
      this.#removePanels(0);
      this.#close = trap.keys = null;
      if (!this.#window.isDestroyed()) this.layOut();
    };
  }

  /** It starts at `left` and `top`, or else ends at `right` and `bottom`. */
  #addPanel(menu: Menu, left: number, right: number, top: number, bottom: number) {
    const { document, window } = this.#page;
    const element = this.#create("div", "", document.body);
    const level = this.#panels.length;
    const items = visibleItems(menu);
    const hasMarks = items.some(item => item.type in ariaRoles || item.icon);
    element.role = "menu";
    items.forEach((item, index) => {
      if (item.type === "separator") return this.#create("hr", "", element);
      const row = this.#create("div", "", element);
      const keys = item.accelerator ? accelerator.format(accelerator.parse(item.accelerator)) : "";
      row.role = item.type === "header" ? "heading" : (ariaRoles[item.type] ?? "menuitem");
      row.ariaLabel = withoutMnemonic(item.label);
      row.ariaDisabled = String(!item.enabled);
      if (item.type in ariaRoles) row.ariaChecked = String(item.checked);
      const { toolTip } = item;
      if (toolTip) row.title = toolTip;
      if (hasMarks) {
        const mark = this.#create("b", "", row);
        if (item.checked) mark.innerHTML = icons[item.type];
        else {
          const { icon } = item;
          if (icon) this.#create("img", "", mark).src = require("internal/desktop/system").toImage(icon).toDataURL();
        }
      }
      const label = this.#create("span", row.ariaLabel, row);
      const { sublabel } = item;
      if (sublabel) this.#create("small", sublabel, label);
      const end = this.#create("kbd", keys, row);
      if (item.submenu) end.innerHTML = icons.submenu;
      row.onmouseenter = () => {
        this.#select(level, index);
        this.#enter(false);
      };
      row.onclick = () => item.submenu || this.#activate(item);
    });
    this.#panels.push({ items, element, selected: -1 });
    const { width, height } = element.getBoundingClientRect();
    element.style.left = Math.max(0, left + width > window.innerWidth ? right - width : left) + "px";
    element.style.top = Math.max(0, top + height > window.innerHeight ? bottom - height : top) + "px";
  }

  #removePanels(from: number) {
    for (const panel of this.#panels.splice(from)) panel.element.remove();
  }

  #select(level: number, index: number) {
    const panel = this.#panels[level];
    const { children } = panel.element;
    this.#removePanels(level + 1);
    children[panel.selected]?.classList.remove("selected");
    panel.selected = panel.items[index].enabled ? index : -1;
    children[panel.selected]?.classList.add("selected");
    children[index].scrollIntoView({ block: "nearest" });
  }

  #move(from: number, step: number, matches = (_item: MenuItem) => true) {
    const { items } = this.#panels.at(-1)!;
    for (let i = 1; i <= items.length; i++) {
      const index = (from + step * i + items.length * 2) % items.length;
      if (items[index].type === "separator" || !items[index].enabled || !matches(items[index])) continue;
      return this.#select(this.#panels.length - 1, index);
    }
  }

  #enter(selectsFirst: boolean): boolean {
    const { items, element, selected } = this.#panels.at(-1)!;
    const submenu = items[selected]?.submenu;
    if (!submenu) return false;
    const { left, right, top } = element.children[selected].getBoundingClientRect();
    this.#addPanel(submenu, right, left, top - 4, this.#page.window.innerHeight);
    if (selectsFirst) this.#move(-1, 1);
    return true;
  }

  #activate(item: MenuItem) {
    if (!item.enabled) return;
    this.#close!();
    item[kActivate](this.#window);
  }

  #sideways(step: number) {
    if (this.#open >= 0) this.#openBar((this.#open + step + this.#bar.length) % this.#bar.length);
  }

  #handleKey(key: string) {
    const level = this.#panels.length - 1;
    const { items, selected } = this.#panels[level];
    switch (key) {
      case "ArrowDown":
        return this.#move(selected, 1);
      case "ArrowUp":
        return this.#move(Math.max(selected, 0), -1);
      case "Home":
        return this.#move(-1, 1);
      case "End":
        return this.#move(0, -1);
      case "ArrowRight":
        return this.#enter(true) || this.#sideways(1);
      case "ArrowLeft":
        return level > 0 ? this.#removePanels(level) : this.#sideways(-1);
      case "Escape":
        return level > 0 ? this.#removePanels(level) : this.#close!();
      case "Enter":
      case " ":
        return this.#enter(true) || (selected >= 0 && this.#activate(items[selected]));
    }
    const letter = key.toLowerCase();
    const matches = (item: MenuItem) => mnemonicOf(item.label) === letter;
    if (key.length !== 1) return;
    this.#move(selected, 1, matches);
    if (items.filter(item => item.enabled && matches(item)).length === 1) this.#handleKey("Enter");
  }
}

export default {
  Menu,
  MenuItem,
  deferByKey,
  activateByKey,
  attach,
  popUpUnderTray,
  createMenus: (window: object, barHeight: number) => new Menus(window, barHeight),
  setWindowMenu,
  setDefaultApplicationMenu,
};
