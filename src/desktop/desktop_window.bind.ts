import * as b from "../codegen/bindgen-lib.ts";
import { DesktopPoint, DesktopRectangle } from "./desktop_base.bind.ts";
import {
  anything,
  flag,
  js,
  number,
  numberIfAny,
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

export default b.module({ rustPath: "crate::window", feature: "Desktop", isCold: true, membersInTable: false });

const unlessFalse = b.bool.otherAsNull;
const window = b.ref("DesktopBaseWindow");
const view = b.ref("DesktopView");

export const OverlayOptions = b.dictionary(
  { color: ownedTextIfAny, symbolColor: ownedTextIfAny, height: numberIfAny },
  { fromJS: true },
);
export const WindowInit = b.dictionary(
  {
    key: anything,
    title: b.string.loose.utf8.owned.nullable.optional,
    x: numberIfAny,
    y: numberIfAny,
    width: numberIfAny,
    height: numberIfAny,
    minWidth: numberIfAny,
    minHeight: numberIfAny,
    maxWidth: numberIfAny,
    maxHeight: numberIfAny,
    useContentSize: flag,
    center: unlessFalse,
    show: unlessFalse,
    paintWhenInitiallyHidden: unlessFalse,
    focus: unlessFalse,
    focusable: unlessFalse,
    frame: unlessFalse,
    titleBarStyle: ownedTextIfAny,
    titleBarOverlay: b.any.falsyAsNull,
    trafficLightPosition: DesktopPoint.nullable.optional,
    transparent: flag,
    vibrancy: ownedTextIfAny,
    visualEffectState: ownedTextIfAny,
    backgroundMaterial: ownedTextIfAny,
    backgroundColor: ownedTextIfAny,
    resizable: unlessFalse,
    movable: unlessFalse,
    minimizable: unlessFalse,
    maximizable: unlessFalse,
    fullscreenable: unlessFalse,
    closable: unlessFalse,
    hasShadow: unlessFalse,
    roundedCorners: unlessFalse,
    hiddenInMissionControl: unlessFalse,
    acceptFirstMouse: flag,
    maximized: flag,
    fullscreen: flag,
    simpleFullscreen: flag,
    kiosk: flag,
    alwaysOnTop: flag,
    skipTaskbar: flag,
    opacity: numberIfAny,
    icon: b.any.falsyAsNull,
    parent: window.nullable.optional,
    modal: flag,
    type: { type: ownedTextIfAny, rustName: "kind" },
    autoHideMenuBar: flag,
    tabbingIdentifier: ownedTextIfAny,
    launchCover: anything,
    webContents: anything,
    webPreferences: anything,
  },
  { webidl: true },
);
export const WorkspaceOptions = b.dictionary({ visibleOnFullScreen: flag });
export const EndCoverOptions = b.dictionary({ dropInput: flag, keep: b.array(DesktopRectangle).nullable });
export const CoverFieldInit = b.dictionary({
  bounds: DesktopRectangle,
  color: ownedTextIfAny,
  letterSpacing: numberIfAny,
});
export const InputInit = b.dictionary({
  type: { type: b.string.utf8.owned, rustName: "kind" },
  modifiers: ownedTexts.nullable,
  x: numberIfAny,
  y: numberIfAny,
  button: ownedTextIfAny,
  clickCount: numberIfAny,
  deltaX: numberIfAny,
  deltaY: numberIfAny,
  keyCode: ownedTextIfAny,
  repeat: flag,
  text: ownedTextIfAny,
  replacementStart: numberIfAny,
  replacementEnd: numberIfAny,
  files: ownedTexts.nullable,
});

const switchTo = { args: { on: flag }, ...js };
const size = { args: { width: number, height: number }, ...js };
const pair = { returns: b.array(b.f64), ...js };
/** `resizable`, `isResizable()` and `setResizable()` */
const flagOf = (name: string, getter: string, setter?: string) => {
  const rustName = name.replace(/[A-Z]/g, it => "_" + it.toLowerCase());
  return {
    [name]: { getter: b.bool.loose, setter: js, rustName },
    [getter]: { returns: b.bool, rustName: "get_" + rustName },
    ...(setter && { [setter]: { ...switchTo, rustName: "set_" + rustName } }),
  };
};
const statics = {
  getAllWindows: returnsObject,
  getFocusedWindow: { returns: b.any, capability: "heap" },
  fromId: { args: { id: numberIfAny }, returns: b.any, capability: "heap" },
} as const;
const construct = { args: { options: WindowInit.default({}) }, passStructure: true, ...js };

export const DesktopBaseWindow = b.interface("DesktopBaseWindow", {
  ofModule: true,
  name: "BaseWindow",
  rustPath: "crate::window::Window",
  prototypeBase: "EventEmitter",
  inlineCapacity: 2,
  internalFields: {
    key: b.any,
    parent: window,
    menu: b.ref("DesktopMenu"),
    drawnMenus: b.ref("DesktopDrawnMenus"),
    contentView: view,
    page: b.any,
    defaultStyle: b.any,
    renderer: b.any,
    contents: b.any,
    contentsView: view,
    browserViews: b.any,
    touchBar: b.ref("ElectronTouchBar"),
  },
  construct,
  static: { ...statics, clearLaunchCover: js },
  proto: withAccessors({
    id: { getter: b.u32 },
    title: { getter: text, setter: js },
    accessibleTitle: { getter: text, setter: true },
    devicePixelRatio: { getter: b.f64 },
    contentView: { getter: view, setter: true, ...js },
    representedFilename: { getter: text, setter: js },
    fullScreen: { getter: b.bool.loose, setter: true, ...js },
    tabbingIdentifier: { getter: b.any, ...js },
    ...flagOf("autoHideMenuBar", "isMenuBarAutoHide", "setAutoHideMenuBar"),
    ...flagOf("closable", "isClosable", "setClosable"),
    ...flagOf("contentProtected", "isContentProtected", "setContentProtection"),
    ...flagOf("documentEdited", "isDocumentEdited", "setDocumentEdited"),
    ...flagOf("enabled", "isEnabled", "setEnabled"),
    ...flagOf("focusable", "isFocusable", "setFocusable"),
    ...flagOf("fullScreenable", "isFullScreenable", "setFullScreenable"),
    ...flagOf("hiddenInMissionControl", "isHiddenInMissionControl", "setHiddenInMissionControl"),
    ...flagOf("kiosk", "isKiosk", "setKiosk"),
    ...flagOf("maximizable", "isMaximizable", "setMaximizable"),
    ...flagOf("menuBarVisible", "isMenuBarVisible", "setMenuBarVisibility"),
    ...flagOf("minimizable", "isMinimizable", "setMinimizable"),
    ...flagOf("movable", "isMovable", "setMovable"),
    ...flagOf("resizable", "isResizable", "setResizable"),
    ...flagOf("shadow", "hasShadow", "setHasShadow"),
    ...flagOf("simpleFullScreen", "isSimpleFullScreen", "setSimpleFullScreen"),
    ...flagOf("visibleOnAllWorkspaces", "isVisibleOnAllWorkspaces"),
    excludedFromShownWindowsMenu: { getter: b.bool.loose, setter: js },
    setVisibleOnAllWorkspaces: {
      args: { on: flag, options: WorkspaceOptions.nullable.optional },
      rustName: "show_on_all_workspaces",
      ...js,
    },
    isAlwaysOnTop: { returns: b.bool },
    setAlwaysOnTop: { args: { on: flag, level: textIfAny, relativeLevel: b.i32.wrap.default(0) }, ...js },

    close: js,
    destroy: js,
    "@@dispose": { rustName: "destroy", ...js },
    isDestroyed: { returns: b.bool },
    show: js,
    showInactive: js,
    hide: js,
    isVisible: returnsFlag,
    focus: js,
    blur: js,
    moveTop: js,
    moveAbove: { args: { mediaSourceId: text }, ...js },
    isFocused: returnsFlag,
    isModal: { returns: b.bool },
    minimize: js,
    restore: js,
    isMinimized: returnsFlag,
    maximize: js,
    unmaximize: js,
    isMaximized: returnsFlag,
    setFullScreen: switchTo,
    isFullScreen: { rustName: "get_full_screen", ...returnsFlag },
    isNormal: returnsFlag,

    getBounds: returnsObject,
    setBounds: { args: { bounds: DesktopRectangle, animate: flag }, ...js },
    getContentBounds: returnsObject,
    setContentBounds: { args: { bounds: DesktopRectangle, animate: flag }, ...js },
    getNormalBounds: returnsObject,
    getSize: pair,
    setSize: size,
    getContentSize: pair,
    setContentSize: size,
    getPosition: pair,
    setPosition: { args: { x: number, y: number }, ...js },
    center: js,
    getMinimumSize: { returns: b.array(b.f64) },
    setMinimumSize: size,
    getMaximumSize: { returns: b.array(b.f64) },
    setMaximumSize: size,

    getTitle: { returns: b.string.utf8 },
    setTitle: { args: { title: text }, ...js },
    getRepresentedFilename: { returns: b.string.utf8 },
    setRepresentedFilename: { args: { filename: text }, ...js },
    setSkipTaskbar: switchTo,
    getOpacity: { returns: b.f64 },
    setOpacity: { args: { opacity: number }, ...js },
    setIgnoreMouseEvents: switchTo,
    flashFrame: switchTo,
    getBackgroundColor: { returns: b.string.utf8 },
    setBackgroundColor: { args: { color: text }, ...js },
    setVibrancy: { args: { type: textIfAny }, ...js },
    setBackgroundMaterial: { args: { material: textIfAny }, ...js },
    setTitleBarOverlay: { args: { options: OverlayOptions }, ...js },
    setWindowButtonVisibility: switchTo,
    setWindowButtonPosition: { args: { position: DesktopPoint.nullable }, ...js },
    setTrafficLightPosition: {
      args: { position: DesktopPoint.nullable },
      rustName: "set_window_button_position",
      ...js,
    },
    getWindowButtonPosition: returnsObject,
    getNativeWindowHandle: returnsObject,
    getMediaSourceId: returnsText,
    getParentWindow: { returns: window.nullable },
    setParentWindow: { args: { parent: window.nullable }, ...js },
    getChildWindows: returnsObject,
    getContentView: { returns: view, ...js },
    setContentView: { args: { view }, ...js },
    setMenu: { args: { menu: b.ref("DesktopMenu").nullable }, ...js },
    removeMenu: js,
    sendInputEvent: { args: { event: InputInit }, ...js },

    isLaunchCoverShown: { returns: b.bool },
    hasLaunchCoverInput: returnsFlag,
    whenLaunchCoverInput: returnsPromise,
    endLaunchCover: { args: { options: EndCoverOptions.nullable.optional }, ...js },
    saveLaunchCover: {
      args: {
        rect: DesktopRectangle.nullable.optional,
        field: CoverFieldInit.nullable.optional,
        behind: textIfAny,
      },
      ...returnsObject,
    },

    previewFile: { args: { path: text, displayName: textIfAny }, ...js },
    closeFilePreview: js,
    setIcon: { args: { icon: b.any }, ...js },
    setShape: { args: { rects: b.sequenceVec(DesktopRectangle) }, ...js },
    setSheetOffset: { args: { offsetY: number, offsetX: number.default(0) }, ...js },
    setAutoHideCursor: switchTo,
    setTouchBar: { args: { touchBar: b.any }, ...js },
    setAspectRatio: { args: { aspectRatio: number, extraSize: DesktopRectangle.nullable.optional }, ...js },
    setProgressBar: { args: { progress: number }, ...js },
    invalidateShadow: js,
    addTabbedWindow: { args: { window }, ...js },
    selectNextTab: js,
    selectPreviousTab: js,
    showAllTabs: js,
    mergeAllWindows: js,
    moveTabToNewWindow: js,
    toggleTabBar: js,
    ...sharing(
      "nothing",
      "hookWindowMessage setAccentColor setAppDetails setOverlayIcon " +
        "setThumbnailClip setThumbnailToolTip unhookAllWindowMessages unhookWindowMessage",
    ),
    ...sharing("no", "getAccentColor isSnapped isTabletMode isWindowMessageHooked setThumbarButtons", {
      returns: b.bool,
    }),
  }),
});

const edit = Object.fromEntries("cut copy paste pasteAndMatchStyle selectAll undo redo".split(" ").map(it => [it, js]));

export const DesktopWindow = b.interface("DesktopWindow", {
  ofModule: true,
  name: "Window",
  extends: DesktopBaseWindow,
  construct,
  proto: {
    window: { getter: b.any, ...js },
    document: { getter: b.any, ...js },
    render: { args: { content: anything }, ...returnsObject },
    loadHTML: { args: { html: text, url: anything }, rustName: "load_html", ...returnsObject },
    loadFile: { args: { path: b.any }, ...returnsPromise },
    insertCSS: { args: { css: b.DOMString }, rustName: "insert_css", ...returnsObject },
    removeInsertedCSS: { args: { key: b.any }, rustName: "remove_inserted_css", ...js },
    findInPage: { args: { text: b.DOMString, options: anything }, ...returnsObject },
    stopFindInPage: { args: { action: anything }, ...js },
    capturePage: { args: { rect: DesktopRectangle.nullable.optional }, ...returnsObject },
    getZoomFactor: { returns: b.f64 },
    setZoomFactor: { args: { factor: number }, ...js },
    getSelectedText: returnsObject,
    ...edit,
  },
});

const forwarded = { args: { values: b.rest(b.any) }, ...returnsObject };

export const DesktopBrowserWindow = b.interface("DesktopBrowserWindow", {
  ofModule: true,
  name: "BrowserWindow",
  extends: DesktopBaseWindow,
  construct,
  static: {
    ...statics,
    fromWebContents: { args: { webContents: b.any }, ...returnsObject },
    fromBrowserView: { args: { browserView: view }, returns: b.any, capability: "heap" },
  },
  proto: {
    webContents: { getter: b.any, field: "contents" },
    loadURL: { ...forwarded, rustName: "load_url" },
    loadFile: forwarded,
    reload: forwarded,
    capturePage: forwarded,
    showDefinitionForSelection: forwarded,
    focusOnWebView: js,
    blurWebView: {},
    addBrowserView: { args: { browserView: view }, ...js },
    removeBrowserView: { args: { browserView: view }, ...js },
    setBrowserView: { args: { browserView: view.nullable }, ...js },
    setTopBrowserView: { args: { browserView: view }, rustName: "add_browser_view", ...js },
    getBrowserViews: returnsObject,
    getBrowserView: returnsObject,
  },
});

export const DesktopView = b.interface("DesktopView", {
  ofModule: true,
  name: "View",
  rustPath: "crate::view::View",
  prototypeBase: "EventEmitter",
  internalFields: { parent: view, children: b.any, root: window, shownIn: window, contents: b.any },
  construct: {},
  proto: {
    children: { getter: b.any, ...js },
    addChildView: { args: { view: b.any, index: numberIfAny }, ...js },
    removeChildView: { args: { view: b.any }, ...js },
    setBounds: { args: { bounds: DesktopRectangle }, ...js },
    getBounds: returnsObject,
    setBackgroundColor: { args: { color: text }, ...js },
    setBackgroundBlur: {},
    setBorderRadius: { args: { radius: number }, ...js },
    setVisible: switchTo,
    getVisible: { returns: b.bool },
  },
});

export const ContentsViewInit = b.dictionary({ webContents: anything, webPreferences: anything }, { webidl: true });
const constructWithContents = { args: { options: ContentsViewInit.default({}) }, passStructure: true, ...js };

export const DesktopWebContentsView = b.interface("DesktopWebContentsView", {
  ofModule: true,
  name: "WebContentsView",
  extends: DesktopView,
  construct: constructWithContents,
  proto: { webContents: { getter: b.any, ...js } },
});

export const AutoResizeOptions = b.dictionary({ width: flag, height: flag, horizontal: flag, vertical: flag });

export const DesktopBrowserView = b.interface("DesktopBrowserView", {
  ofModule: true,
  name: "BrowserView",
  extends: DesktopWebContentsView,
  construct: constructWithContents,
  proto: { setAutoResize: { args: { options: AutoResizeOptions }, ...js } },
});

export const DesktopImageView = b.interface("DesktopImageView", {
  ofModule: true,
  name: "ImageView",
  extends: DesktopView,
  construct: {},
  proto: { setImage: { args: { image: b.any }, ...js } },
});
