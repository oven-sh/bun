// `TouchBar`
import * as b from "../codegen/bindgen-lib.ts";
import { anything, js } from "./schema.ts";

export default b.module({ rustPath: "crate::touch_bar", feature: "Desktop", isCold: true, membersInTable: false });

const construct = { args: { options: anything }, passStructure: true, ...js };
const each = (names: string, member: object) => Object.fromEntries(names.split(" ").map(name => [name, member]));

export const ElectronTouchBarItem = b.interface("ElectronTouchBarItem", {
  ofModule: true,
  name: "TouchBarItem",
  rustPath: "crate::touch_bar::Item",
  prototypeBase: "EventEmitter",
  internalFields: ["config"],
  proto: {
    id: { getter: b.string.utf8 },
    type: { getter: b.string.utf8 },
    ...each(
      "accessibilityLabel availableColors backgroundColor continuous enabled icon iconPosition items label maxValue " +
        "minValue mode overlayStyle segmentStyle segments selectedColor selectedIndex selectedStyle showArrowButtons " +
        "showCloseButton size textColor value",
      { getter: b.any, setter: true, ...js },
    ),
  },
});

const item = (name: string) =>
  b.interface("Electron" + name, { ofModule: true, name, extends: ElectronTouchBarItem, construct });

export const ElectronTouchBarButton = item("TouchBarButton");
export const ElectronTouchBarColorPicker = item("TouchBarColorPicker");
export const ElectronTouchBarGroup = item("TouchBarGroup");
export const ElectronTouchBarLabel = item("TouchBarLabel");
export const ElectronTouchBarOtherItemsProxy = item("TouchBarOtherItemsProxy");
export const ElectronTouchBarPopover = item("TouchBarPopover");
export const ElectronTouchBarScrubber = item("TouchBarScrubber");
export const ElectronTouchBarSegmentedControl = item("TouchBarSegmentedControl");
export const ElectronTouchBarSlider = item("TouchBarSlider");
export const ElectronTouchBarSpacer = item("TouchBarSpacer");

export const ElectronTouchBar = b.interface("ElectronTouchBar", {
  ofModule: true,
  name: "TouchBar",
  rustPath: "crate::touch_bar::TouchBar",
  prototypeBase: "EventEmitter",
  internalFields: ["items", "escapeItem"],
  construct,
  static: each(
    "TouchBarButton TouchBarColorPicker TouchBarGroup TouchBarLabel TouchBarOtherItemsProxy TouchBarPopover " +
      "TouchBarScrubber TouchBarSegmentedControl TouchBarSlider TouchBarSpacer",
    { getter: b.any, capability: "heap" },
  ),
  proto: { escapeItem: { getter: b.any, setter: js } },
});
