import * as b from "../codegen/bindgen-lib.ts";
import { anything, js, numberIfAny, ownedTextIfAny, ownedTexts, text } from "./schema.ts";

export default b.module({ rustPath: "crate::menu", feature: "Desktop", isCold: true, membersInTable: false });

const menu = b.ref("DesktopMenu");
const item = b.ref("DesktopMenuItem");
const unlessFalse = b.bool.otherAsNull;

export const MenuItemInit = b.dictionary(
  {
    id: b.any,
    type: { type: ownedTextIfAny, rustName: "kind" },
    role: ownedTextIfAny,
    label: b.string.loose.utf8.owned.nullable,
    sublabel: ownedTextIfAny,
    toolTip: ownedTextIfAny,
    accessibilityLabel: ownedTextIfAny,
    accelerator: ownedTextIfAny,
    icon: b.any.falsyAsNull,
    enabled: unlessFalse,
    visible: unlessFalse,
    checked: b.bool.loose.default(false),
    registerAccelerator: unlessFalse,
    acceleratorWorksWhenHidden: unlessFalse,
    submenu: b.any.falsyAsNull,
    click: b.callable.otherAsNull,
    selector: ownedTextIfAny,
  },
  { fromJS: true },
);
export const MenuItemPlace = b.dictionary(
  {
    id: ownedTextIfAny,
    type: { type: ownedTextIfAny, rustName: "kind" },
    visible: unlessFalse,
    before: ownedTexts.nullable,
    after: ownedTexts.nullable,
    beforeGroupContaining: ownedTexts.nullable,
    afterGroupContaining: ownedTexts.nullable,
  },
  { fromJS: true },
);
export const PopupOptions = b.dictionary(
  {
    window: b.ref("DesktopBaseWindow").nullable.optional,
    browserWindow: b.ref("DesktopBaseWindow").nullable.optional,
    x: numberIfAny,
    y: numberIfAny,
    positioningItem: numberIfAny,
    callback: b.callable.otherAsNull,
  },
  { webidl: true },
);

const shown = <T>(getter: T) => ({ getter, setter: js });

export const DesktopMenuItem = b.interface("DesktopMenuItem", {
  ofModule: true,
  name: "MenuItem",
  rustPath: "crate::menu::MenuItem",
  internalFields: { id: b.any, icon: b.any, submenu: menu, menu, onClick: b.any },
  construct: { args: { options: b.object }, passStructure: true, ...js },
  proto: {
    commandId: { getter: b.u32 },
    id: { getter: b.any, setter: true },
    type: { getter: b.string.utf8 },
    role: { getter: b.any, ...js },
    accelerator: { getter: b.any, ...js },
    userAccelerator: { getter: b.any },
    icon: { getter: b.any, setter: js },
    submenu: { getter: b.any },
    menu: { getter: menu.nullable, field: "menu" },
    label: shown(text),
    sublabel: shown(text),
    toolTip: shown(text),
    accessibilityLabel: shown(text),
    enabled: shown(b.bool.loose),
    visible: shown(b.bool.loose),
    checked: shown(b.bool.loose),
    registerAccelerator: { getter: b.bool.loose, setter: true },
    acceleratorWorksWhenHidden: { getter: b.bool.loose, setter: true },
    click: { getter: b.any, setter: { capability: "none", throws: false }, ...js },
  },
});

export const DesktopMenu = b.interface("DesktopMenu", {
  ofModule: true,
  name: "Menu",
  rustPath: "crate::menu::Menu",
  prototypeBase: "EventEmitter",
  internalFields: ["items", "onClose"],
  construct: { passStructure: true, ...js },
  static: {
    buildFromTemplate: { args: { template: b.any }, returns: menu, ...js },
    getApplicationMenu: { returns: menu.nullable, capability: "heap" },
    setApplicationMenu: { args: { menu: menu.nullable }, ...js },
    sendActionToFirstResponder: { args: { action: text }, ...js },
  },
  proto: {
    items: { getter: b.any, field: "items" },
    append: { args: { menuItem: b.any }, ...js },
    insert: { args: { pos: b.u32.clamp, menuItem: b.any }, ...js },
    getMenuItemById: { args: { id: anything }, returns: item.nullable, ...js },
    popup: { args: { options: PopupOptions.default({}) }, ...js },
    closePopup: js,
  },
});

export const ElectronShareMenu = b.interface("ElectronShareMenu", {
  ofModule: true,
  name: "ShareMenu",
  rustPath: "crate::menu::ShareMenu",
  internalFields: { menu },
  construct: { args: { sharingItem: b.object }, passStructure: true, ...js },
  proto: { popup: { args: { options: PopupOptions.default({}) }, ...js }, closePopup: js },
});

export const DesktopDrawnMenus = b.interface("DesktopDrawnMenus", {
  ofModule: true,
  rustPath: "crate::drawn_menus::DrawnMenus",
  noInterfaceObject: true,
  internalFields: { window: b.ref("DesktopBaseWindow"), page: b.any, bar: b.any, panels: b.any, menu },
});
