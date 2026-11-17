import * as b from "../codegen/bindgen-lib.ts";
import { DesktopPoint, DesktopRectangle } from "./desktop_base.bind.ts";
import {
  anything,
  flag,
  js,
  noticesListeners,
  number,
  ownedTextIfAny,
  ownedTexts,
  returnsFlag,
  returnsObject,
  returnsPromise,
  returnsText,
  sharing,
  text,
  textIfAny,
  withAccessors,
} from "./schema.ts";

export default b.module({ feature: "Desktop", isCold: true, membersInTable: false });

const emitter = { namespace: true, prototypeBase: "EventEmitter" } as const;
const menu = b.ref("DesktopMenu");
const bytes = b.bytes({ from: ["buffer"], held: "copied" });

export const DesktopShell = b.interface("DesktopShell", {
  ofModule: true,
  name: "Shell",
  namespace: true,
  static: {
    openExternal: { args: { url: text }, ...returnsPromise },
    openPath: { args: { path: text }, ...returnsPromise },
    showItemInFolder: { args: { path: text }, ...js },
    trashItem: { args: { path: text }, ...returnsPromise },
    beep: js,
    readShortcutLink: js,
    writeShortcutLink: { returns: b.bool },
  },
});

const convertsPoint = { args: { point: DesktopPoint }, ...returnsObject };
const convertsRectangle = { args: { window: b.any, rect: DesktopRectangle }, ...returnsObject };

export const DesktopScreen = b.interface("DesktopScreen", {
  ofModule: true,
  name: "Screen",
  ...emitter,
  static: {
    ...noticesListeners,
    getAllDisplays: returnsObject,
    getPrimaryDisplay: returnsObject,
    getCursorScreenPoint: returnsObject,
    getDisplayNearestPoint: { args: { point: DesktopPoint }, ...returnsObject },
    getDisplayMatching: { args: { rect: DesktopRectangle }, ...returnsObject },
    dipToScreenPoint: convertsPoint,
    dipToScreenRect: convertsRectangle,
    screenToDipPoint: convertsPoint,
    screenToDipRect: convertsRectangle,
  },
});

const setting = { getter: b.bool, ...js };

export const DesktopNativeTheme = b.interface("DesktopNativeTheme", {
  ofModule: true,
  name: "NativeTheme",
  ...emitter,
  static: {
    ...noticesListeners,
    themeSource: { getter: text, setter: js },
    shouldUseDarkColors: setting,
    shouldUseDarkColorsForSystemIntegratedUI: { ...setting, rustName: "should_use_dark_colors" },
    shouldUseHighContrastColors: setting,
    shouldUseInvertedColorScheme: setting,
    prefersReducedTransparency: setting,
    inForcedColorsMode: { getter: b.bool },
  },
});

export const NotificationInit = b.dictionary(
  {
    id: ownedTextIfAny,
    groupId: ownedTextIfAny,
    title: ownedTextIfAny,
    subtitle: ownedTextIfAny,
    body: ownedTextIfAny,
    replyPlaceholder: ownedTextIfAny,
    sound: ownedTextIfAny,
    closeButtonText: ownedTextIfAny,
    toastXml: ownedTextIfAny,
    urgency: ownedTextIfAny,
    timeoutType: ownedTextIfAny,
    silent: flag,
    hasReply: flag,
    actions: b.any.falsyAsNull,
  },
  { webidl: true },
);
const property = { getter: text, setter: true } as const;

export const DesktopNotification = b.interface("DesktopNotification", {
  ofModule: true,
  name: "Notification",
  rustPath: "crate::notification::Notification",
  prototypeBase: "EventEmitter",
  internalFields: ["actions"],
  construct: { args: { options: NotificationInit.default({}) }, passStructure: true, ...js },
  static: {
    isSupported: { returns: b.bool },
    getHistory: returnsPromise,
    remove: { args: { id: b.any }, ...js },
    removeAll: js,
    removeGroup: { args: { groupId: text }, ...js },
  },
  proto: {
    id: { getter: b.string.utf8 },
    groupId: { getter: b.string.utf8 },
    title: property,
    subtitle: property,
    body: property,
    replyPlaceholder: property,
    sound: property,
    closeButtonText: property,
    toastXml: property,
    urgency: property,
    timeoutType: property,
    silent: { getter: b.bool.loose, setter: true },
    hasReply: { getter: b.bool.loose, setter: true },
    actions: { getter: b.any, field: "actions", writable: true },
    show: js,
    close: js,
  },
});

export const DesktopPowerMonitor = b.interface("DesktopPowerMonitor", {
  ofModule: true,
  name: "PowerMonitor",
  ...emitter,
  static: {
    ...noticesListeners,
    getSystemIdleTime: { returns: b.f64, ...js },
    getSystemIdleState: { args: { idleThreshold: number }, ...returnsText },
    getCurrentThermalState: returnsObject,
    isOnBatteryPower: { rustName: "get_on_battery_power", ...returnsFlag },
    onBatteryPower: setting,
  },
});

export const DesktopPowerSaveBlocker = b.interface("DesktopPowerSaveBlocker", {
  ofModule: true,
  name: "PowerSaveBlocker",
  namespace: true,
  static: {
    start: { args: { type: text }, returns: b.u32, ...js },
    stop: { args: { id: number }, ...returnsFlag },
    isStarted: { args: { id: number }, returns: b.bool },
  },
});

export const DesktopGlobalShortcut = b.interface("DesktopGlobalShortcut", {
  ofModule: true,
  name: "GlobalShortcut",
  namespace: true,
  static: {
    register: { args: { accelerator: text, callback: b.callable }, ...returnsFlag },
    registerAll: { args: { accelerators: ownedTexts, callback: b.callable }, ...js },
    isRegistered: { args: { accelerator: text }, ...returnsFlag },
    unregister: { args: { accelerator: text }, ...js },
    unregisterAll: js,
    isSuspended: { returns: b.bool },
    setSuspended: { args: { suspended: flag }, ...js },
  },
});

export const BalloonOptions = b.dictionary({ title: ownedTextIfAny, content: ownedTextIfAny });

export const DesktopTray = b.interface("DesktopTray", {
  ofModule: true,
  name: "Tray",
  rustPath: "crate::tray::Tray",
  prototypeBase: "EventEmitter",
  internalFields: { menu, openMenu: menu },
  construct: { args: { image: b.any, guid: textIfAny }, passStructure: true, ...js },
  proto: {
    setImage: { args: { image: b.any }, ...js },
    setToolTip: { args: { toolTip: text }, ...js },
    setTitle: { args: { title: text }, ...js },
    getTitle: { returns: b.string.utf8 },
    setContextMenu: { args: { menu: menu.nullable }, ...js },
    popUpContextMenu: { args: { menu: anything }, ...js },
    closeContextMenu: js,
    getBounds: returnsObject,
    destroy: js,
    isDestroyed: { returns: b.bool },
    displayBalloon: { args: { options: BalloonOptions }, ...js },
    getGUID: { returns: b.string.utf8.nullable, rustName: "get_guid" },
    setIgnoreDoubleClickEvents: { args: { ignore: flag } },
    getIgnoreDoubleClickEvents: { returns: b.bool },
    ...sharing("nothing", "focus removeBalloon setPressedImage"),
  },
});

export const DesktopSafeStorage = b.interface("DesktopSafeStorage", {
  ofModule: true,
  name: "SafeStorage",
  namespace: true,
  static: {
    isEncryptionAvailable: { returns: b.bool },
    isAsyncEncryptionAvailable: returnsPromise,
    encryptString: { args: { plainText: b.string.utf8 }, ...returnsObject },
    decryptString: { args: { encrypted: b.bytes({ from: ["buffer"] }) }, ...returnsText, capability: "heap" },
    encryptStringAsync: { args: { plainText: b.string.utf8 }, ...returnsPromise },
    decryptStringAsync: { args: { encrypted: bytes }, ...returnsPromise },
  },
});

const subscribes = { args: { event: text, callback: b.callable }, returns: b.u32, ...js };

export const DesktopSystemPreferences = b.interface("DesktopSystemPreferences", {
  ofModule: true,
  name: "SystemPreferences",
  ...emitter,
  static: withAccessors({
    getAnimationSettings: returnsObject,
    isTrustedAccessibilityClient: { args: { prompt: flag }, ...returnsFlag },
    askForMediaAccess: { args: { mediaType: text }, ...returnsPromise },
    getMediaAccessStatus: { args: { mediaType: text }, ...returnsText },
    canPromptTouchID: { rustName: "can_prompt_touch_id", ...returnsFlag },
    promptTouchID: { args: { reason: text }, rustName: "prompt_touch_id", ...returnsPromise },
    getAccentColor: returnsText,
    getColor: { args: { color: text }, ...returnsText },
    getSystemColor: { args: { color: text }, ...returnsText },
    getEffectiveAppearance: returnsText,
    effectiveAppearance: { getter: b.string.utf8, ...js },
    accessibilityDisplayShouldReduceTransparency: setting,
    isSwipeTrackingFromScrollEventsEnabled: returnsFlag,
    getUserDefault: { args: { key: text, type: text }, ...returnsObject },
    setUserDefault: { args: { key: text, type: b.any, value: b.any }, ...js },
    removeUserDefault: { args: { key: text }, ...js },
    registerDefaults: { args: { defaults: b.object }, ...js },
    postNotification: { args: { event: text, userInfo: anything, deliverImmediately: flag }, ...js },
    postLocalNotification: { args: { event: text, userInfo: anything }, ...js },
    postWorkspaceNotification: { args: { event: text, userInfo: anything }, ...js },
    subscribeLocalNotification: subscribes,
    subscribeNotification: subscribes,
    subscribeWorkspaceNotification: subscribes,
    ...sharing("unsubscribe", "unsubscribeLocalNotification unsubscribeNotification unsubscribeWorkspaceNotification", {
      args: { id: b.u32.wrap },
    }),
  }),
});

export const DesktopNet = b.interface("DesktopNet", {
  ofModule: true,
  name: "Net",
  namespace: true,
  static: {
    fetch: { args: { input: b.any, init: anything }, ...returnsPromise },
    isOnline: { returns: b.bool, rustName: "get_online" },
    online: { getter: b.bool },
  },
});
