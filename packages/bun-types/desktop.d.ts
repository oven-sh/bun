/**
 * Windows, menus, dialogs and the other things a desktop app needs. A window shows a DOM document, which Bun lays out and
 * paints on the thread that runs your JavaScript.
 *
 * Add `"DOM"` to `lib` in tsconfig.json for the types of `document` and of the elements.
 *
 * @example
 * ```tsx
 * // @jsxImportSource bun:desktop
 * import { Window, useState } from "bun:desktop";
 *
 * function Counter() {
 *   const [count, setCount] = useState(0);
 *   return <button onClick={() => setCount(count + 1)}>{count}</button>;
 * }
 *
 * new Window({ title: "Counter" }).render(<Counter />);
 * ```
 *
 * @experimental
 * @category Desktop
 */
declare module "bun:desktop" {
  import type { EventEmitter } from "node:events";

  type DomDocument = Bun.__internal.UseLibDomIfAvailable<"document", any>;
  type DomWindow = Bun.__internal.UseLibDomIfAvailable<"window", any>;
  /** An instance of an interface of lib.dom.d.ts, or `any` without it. */
  type Dom<Name extends string> = Bun.__internal.UseLibDomIfAvailable<Name, { prototype: any }>["prototype"];

  interface Point {
    x: number;
    y: number;
  }

  interface Size {
    width: number;
    height: number;
  }

  interface Rectangle extends Point, Size {}

  /** The first argument of many listeners. */
  interface AppEvent {
    readonly defaultPrevented: boolean;
    preventDefault(): void;
  }

  /** An image, the bytes of an image file, or the path of one. */
  type ImageSource = NativeImage | Uint8Array | string;

  /** A key with modifiers, such as `"CmdOrCtrl+Shift+Z"`. */
  type Accelerator = string;

  interface WindowOptions {
    /**
     * If a window with this key is open, the constructor returns it, without its listeners. This is for `bun --hot`, which
     * runs a module again.
     */
    key?: unknown;
    /** @default app.name */
    title?: string;
    x?: number;
    y?: number;
    /** @default 800 */
    width?: number;
    /** @default 600 */
    height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    /** @default true */
    show?: boolean;
    /** Whether it takes the focus when it is shown. @default true */
    focus?: boolean;
    /** `false` for neither a title bar nor a border. CSS `app-region: drag` makes an element move the window. @default true */
    frame?: boolean;
    titleBarStyle?: "default" | "hidden" | "hiddenInset";
    /** macOS only. */
    trafficLightPosition?: Point;
    transparent?: boolean;
    /** macOS only. Any value blurs what is behind the window. */
    vibrancy?: string;
    /** Windows only. */
    backgroundMaterial?: "none" | "mica" | "acrylic" | "tabbed";
    /** A CSS color. */
    backgroundColor?: string;
    /** @default true */
    resizable?: boolean;
    /** @default true */
    movable?: boolean;
    /** macOS only. The click that activates the window also goes to the page. */
    acceptFirstMouse?: boolean;
    /** @default true */
    minimizable?: boolean;
    /** @default true */
    closable?: boolean;
    maximized?: boolean;
    fullscreen?: boolean;
    kiosk?: boolean;
    alwaysOnTop?: boolean;
    skipTaskbar?: boolean;
    opacity?: number;
    icon?: ImageSource;
    parent?: Window;
    /** Needs `parent`. */
    modal?: boolean;
    type?: "normal" | "panel" | "popup";
    /** Leaves out the menu bar on Linux and Windows. Its accelerators still work. */
    autoHideMenuBar?: boolean;
    /**
     * For the main window of a packaged app: it opens before the app's code runs, with the picture that
     * {@link Window.saveLaunchCover} took, until {@link Window.endLaunchCover}. The picture is only shown for the same
     * executable, arguments, displays and values of the variables in `environment`. `false` closes a picture that is
     * on the screen.
     */
    launchCover?: boolean | { environment?: string[] };
  }

  interface ContextMenuParams extends Point {
    pageURL: string;
    linkURL: string;
    linkText: string;
    srcURL: string;
    altText: string;
    titleText: string;
    selectionText: string;
    isEditable: boolean;
    mediaType: "none" | "image" | "video" | "audio" | "canvas";
    editFlags: Record<"canUndo" | "canRedo" | "canCut" | "canCopy" | "canPaste" | "canSelectAll", boolean>;
  }

  interface WindowEventMap {
    "blur": [];
    /** `preventDefault()` keeps it open. */
    "close": [event: AppEvent];
    "closed": [];
    /** A right click that the document did not cancel. */
    "context-menu": [event: AppEvent, params: ContextMenuParams];
    "did-finish-load": [];
    "dom-ready": [];
    "enter-full-screen": [];
    "focus": [];
    "hide": [];
    "leave-full-screen": [];
    "maximize": [];
    "minimize": [];
    "move": [];
    /** After the first paint. */
    "ready-to-show": [];
    "resize": [];
    "restore": [];
    "show": [];
    "unmaximize": [];
    /** A link was followed. `http:`, `https:` and `mailto:` URLs open in the default app unless this is canceled. */
    "will-navigate": [event: AppEvent, url: string];
  }

  type Modifier = "shift" | "control" | "ctrl" | "alt" | "meta" | "command" | "cmd";

  type InputEvent = { modifiers?: Modifier[] } & (
    | { type: "mouseMove" | "mouseLeave"; x: number; y: number }
    | { type: "mouseDown" | "mouseUp"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
    | { type: "mouseWheel"; x: number; y: number; deltaX?: number; deltaY?: number }
    | { type: "keyDown" | "keyUp"; keyCode: Accelerator; repeat?: boolean }
    | { type: "char"; text: string }
  );

  class Window extends EventEmitter<WindowEventMap> implements Disposable {
    static getAllWindows(): Window[];
    static getFocusedWindow(): Window | null;
    static fromId(id: number): Window | null;
    /** Deletes the picture. Resizing the window and a change of the theme do so too. */
    static clearLaunchCover(): void;

    constructor(options?: WindowOptions);

    readonly id: number;
    /**
     * After `import "bun:desktop/dom"`, the `window` of the first `Window` is `globalThis`. That of any other is an object
     * of its own in the same realm, so nodes can move between windows.
     */
    readonly window: DomWindow;
    readonly document: DomDocument;
    readonly devicePixelRatio: number;
    title: string;

    /** Renders JSX of `bun:desktop` into `document.body`. */
    render(content: Child): this;
    /**
     * Replaces the document. Scripts in it only run in the window whose `window` is `globalThis`.
     *
     * @param url What relative URLs in the document are resolved against.
     */
    loadHTML(html: string, url?: string | URL): Promise<void>;
    loadFile(path: string | URL): Promise<void>;
    /** @returns The key for {@link removeInsertedCSS}. */
    insertCSS(css: string): string;
    removeInsertedCSS(key: string): void;
    /** As in Electron, `findNext` is `true` for the first request of a search and `false` for those that follow. */
    findInPage(
      text: string,
      options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
    ): { matches: number; active: number; rect: Rectangle | null };
    stopFindInPage(action?: "clearSelection" | "keepSelection" | "activateSelection"): void;
    capturePage(rect?: Rectangle): NativeImage;
    /** As if the user had done it. For tests. */
    sendInputEvent(event: InputEvent): void;

    /** Fires `beforeunload` in the document and emits `close`. Either can keep the window open. */
    close(): void;
    destroy(): void;
    isDestroyed(): boolean;
    show(): void;
    showInactive(): void;
    hide(): void;
    isVisible(): boolean;
    focus(): void;
    moveTop(): void;
    isFocused(): boolean;
    isModal(): boolean;
    minimize(): void;
    restore(): void;
    isMinimized(): boolean;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    setFullScreen(on: boolean): void;
    isFullScreen(): boolean;
    setSimpleFullScreen(on: boolean): void;
    isSimpleFullScreen(): boolean;
    isNormal(): boolean;

    getBounds(): Rectangle;
    setBounds(bounds: Partial<Rectangle>): void;
    getContentBounds(): Rectangle;
    getNormalBounds(): Rectangle;
    getSize(): [width: number, height: number];
    setSize(width: number, height: number): void;
    getContentSize(): [width: number, height: number];
    setContentSize(width: number, height: number): void;
    getPosition(): [x: number, y: number];
    /** Wayland does not let a window choose its position. */
    setPosition(x: number, y: number): void;
    center(): void;
    getMinimumSize(): [width: number, height: number];
    setMinimumSize(width: number, height: number): void;
    getMaximumSize(): [width: number, height: number];
    setMaximumSize(width: number, height: number): void;
    isResizable(): boolean;
    setResizable(resizable: boolean): void;
    isClosable(): boolean;
    setClosable(closable: boolean): void;

    getTitle(): string;
    setTitle(title: string): void;
    isAlwaysOnTop(): boolean;
    setAlwaysOnTop(on: boolean): void;
    setSkipTaskbar(on: boolean): void;
    isVisibleOnAllWorkspaces(): boolean;
    setVisibleOnAllWorkspaces(on: boolean): void;
    /** Keeps the window out of screenshots, on macOS and Windows. */
    setContentProtection(on: boolean): void;
    getOpacity(): number;
    setOpacity(opacity: number): void;
    setIgnoreMouseEvents(ignore: boolean): void;
    flashFrame(on: boolean): void;
    setBackgroundColor(color: string): void;
    setVibrancy(vibrancy: string | null): void;
    setBackgroundMaterial(material: NonNullable<WindowOptions["backgroundMaterial"]>): void;
    isDocumentEdited(): boolean;
    setDocumentEdited(edited: boolean): void;
    getRepresentedFilename(): string;
    setRepresentedFilename(path: string): void;
    setWindowButtonPosition(position: Point): void;
    /**
     * Shows the contents. What was typed goes to the field that has the focus, if there is one. The last click is made
     * if the contents look like the picture there. Without a call, the picture goes after 10 seconds (a minute if text waits) and the input is
     * dropped.
     */
    endLaunchCover(options?: {
      dropInput?: boolean;
      /** These parts stay until the next call, or until the user clicks elsewhere or scrolls them. */
      keep?: Rectangle[];
    }): void;
    isLaunchCoverShown(): boolean;
    /** Whether the user waits for keys or for a click that {@link Window.endLaunchCover} would make now. */
    hasLaunchCoverInput(): boolean;
    whenLaunchCoverInput(): Promise<void>;
    /** Takes the picture for the next launch, or replaces `rect` in it. Resolves to whether there is one. */
    saveLaunchCover(
      rect?: Rectangle,
      /**
       * The empty field that has the focus now and at launch. One line of what is typed is drawn over the picture, in
       * the font of the placeholder.
       */
      field?: { bounds: Rectangle; color?: string; letterSpacing?: number },
    ): Promise<boolean>;
    getZoomFactor(): number;
    setZoomFactor(factor: number): void;
    getNativeWindowHandle(): Buffer;
    getParentWindow(): Window | null;
    getChildWindows(): Window[];

    /** Linux and Windows only. */
    setMenu(menu: Menu | null): void;
    removeMenu(): void;
    isMenuBarVisible(): boolean;
    setMenuBarVisibility(visible: boolean): void;

    getSelectedText(): string;
    cut(): void;
    copy(): void;
    paste(): void;
    pasteAndMatchStyle(): void;
    selectAll(): void;
    undo(): void;
    redo(): void;

    [Symbol.dispose](): void;
  }

  const BaseWindow: typeof Window;

  interface AppEventMap {
    /** macOS only: the icon in the Dock was clicked. */
    "activate": [event: AppEvent, hasVisibleWindows: boolean];
    "before-quit": [event: AppEvent];
    "open-file": [event: AppEvent, path: string];
    "open-url": [event: AppEvent, url: string];
    "quit": [event: AppEvent, exitCode: number];
    "ready": [event: AppEvent, launchInfo: object];
    "second-instance": [event: AppEvent, argv: string[], workingDirectory: string, additionalData: unknown];
    "session-end": [event: AppEvent];
    "will-quit": [event: AppEvent];
    /** Without a listener, the app quits. */
    "window-all-closed": [];
    "window-blur": [event: AppEvent, window: Window];
    "window-created": [event: AppEvent, window: Window];
    "window-focus": [event: AppEvent, window: Window];
  }

  type PathName =
    | "home"
    | "appData"
    | "userData"
    | "sessionData"
    | "cache"
    | "logs"
    | "crashDumps"
    | "temp"
    | "exe"
    | "module"
    | "resources"
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";

  interface Dock {
    setBadge(text: string): void;
    getBadge(): string;
    bounce(): number;
    cancelBounce(id?: number): void;
    hide(): void;
    show(): Promise<void>;
    isVisible(): boolean;
    setMenu(menu: Menu | null): void;
    getMenu(): Menu | null;
  }

  interface App extends EventEmitter<AppEventMap> {
    name: string;
    /** Whether it runs from a bundle that `bun compile --desktop` made. */
    readonly isPackaged: boolean;
    readonly identifier: string;
    badgeCount: number;
    applicationMenu: Menu | null;
    /** macOS only. */
    readonly dock: Dock | undefined;

    /** There is no need to wait for this before making a {@link Window}. */
    whenReady(): Promise<void>;
    isReady(): boolean;
    /** Closes the windows, unless a listener of `before-quit`, `close` or `will-quit` cancels it. */
    quit(): void;
    exit(exitCode?: number): never;
    /** Starts the app again when this process exits. */
    relaunch(options?: { args?: string[]; execPath?: string }): void;
    focus(options?: { steal?: boolean }): void;
    hide(): void;
    show(): void;
    getName(): string;
    setName(name: string): void;
    getVersion(): string;
    getAppPath(): string;
    getPath(name: PathName): string;
    setPath(name: PathName, path: string): void;
    setAppLogsPath(path?: string): void;
    getLocale(): string;
    getSystemLocale(): string;
    getLocaleCountryCode(): string;
    getPreferredSystemLanguages(): string[];
    /**
     * The browser that renders `<iframe>`s, in sandboxed processes of its own. Call it before the first one is shown.
     * With `null` they stay empty.
     *
     * The default is the `electron` directory in the resources of the app, or else an installed Chrome, Chromium or Edge.
     */
    setWebEngine(
      engine: {
        type: "electron" | "chromium";
        /** The absolute path of the executable. */
        path: string;
        /** More switches for its command line. */
        args?: string[];
      } | null,
    ): void;
    setAppUserModelId(id: string): void;
    setActivationPolicy(policy: "regular" | "accessory" | "prohibited"): void;
    setBadgeCount(count?: number): boolean;
    getBadgeCount(): number;
    addRecentDocument(path: string): void;
    setAboutPanelOptions(options: {
      applicationName?: string;
      applicationVersion?: string;
      copyright?: string;
      credits?: string;
    }): void;
    showAboutPanel(): void;
    showEmojiPanel(): void;
    isEmojiPanelSupported(): boolean;
    /** `false` if another instance has the lock, which then emits `second-instance`. */
    requestSingleInstanceLock(additionalData?: unknown): boolean;
    hasSingleInstanceLock(): boolean;
    releaseSingleInstanceLock(): void;
    setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
    isDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
    removeAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
    getLoginItemSettings(): { openAtLogin: boolean };
    setLoginItemSettings(settings: { openAtLogin?: boolean; path?: string; args?: string[] }): void;
    /** The names of the installed font families. */
    getFonts(): string[];
  }

  const app: App;

  type MenuRole =
    | "undo"
    | "redo"
    | "cut"
    | "copy"
    | "paste"
    | "pasteAndMatchStyle"
    | "selectAll"
    | "close"
    | "minimize"
    | "zoom"
    | "togglefullscreen"
    | "resetZoom"
    | "zoomIn"
    | "zoomOut"
    | "quit"
    | "about"
    | "hide"
    | "hideOthers"
    | "unhide"
    | "front"
    | "services"
    | "window"
    | "help"
    | "appMenu"
    | "fileMenu"
    | "editMenu"
    | "viewMenu"
    | "windowMenu";

  interface MenuItemOptions {
    id?: string;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
    role?: MenuRole;
    label?: string;
    sublabel?: string;
    toolTip?: string;
    accelerator?: Accelerator;
    enabled?: boolean;
    visible?: boolean;
    checked?: boolean;
    submenu?: (MenuItemOptions | MenuItem)[] | Menu;
    click?(item: MenuItem, window: Window | undefined, event: AppEvent): void;
  }

  class MenuItem {
    constructor(options: MenuItemOptions);

    readonly commandId: number;
    readonly id: string | undefined;
    readonly type: NonNullable<MenuItemOptions["type"]>;
    readonly role: MenuRole | undefined;
    readonly accelerator: Accelerator | undefined;
    readonly sublabel: string;
    readonly toolTip: string;
    readonly submenu: Menu | undefined;
    readonly menu: Menu | null;
    click: MenuItemOptions["click"];
    label: string;
    enabled: boolean;
    visible: boolean;
    checked: boolean;
  }

  class Menu extends EventEmitter<{ "menu-will-show": [event: AppEvent]; "menu-will-close": [event: AppEvent] }> {
    static buildFromTemplate(template: (MenuItemOptions | MenuItem)[]): Menu;
    static getApplicationMenu(): Menu | null;
    /** The menu bar of the screen on macOS, and of each window elsewhere. */
    static setApplicationMenu(menu: Menu | null): void;

    readonly items: readonly MenuItem[];

    append(item: MenuItem): void;
    insert(position: number, item: MenuItem): void;
    getMenuItemById(id: string): MenuItem | null;
    /** At the mouse pointer, unless `x` and `y` are given. */
    popup(options?: { window?: Window; x?: number; y?: number; callback?(): void }): void;
    closePopup(): void;
  }

  interface FileDialogOptions {
    title?: string;
    message?: string;
    defaultPath?: string;
    /** Extensions have no dot. */
    filters?: { name: string; extensions: string[] }[];
  }

  interface OpenDialogOptions extends FileDialogOptions {
    properties?: ("openFile" | "openDirectory" | "multiSelections" | "createDirectory")[];
  }

  interface MessageBoxOptions {
    message: string;
    detail?: string;
    title?: string;
    type?: "none" | "info" | "question" | "warning" | "error";
    /** @default ["OK"] */
    buttons?: string[];
    defaultId?: number;
    /** The response if it is closed without a button. */
    cancelId?: number;
    checkboxLabel?: string;
    checkboxChecked?: boolean;
    signal?: AbortSignal;
  }

  /** With a window, the dialog is modal to it. */
  interface ShowDialog<Options, Result> {
    (options: Options): Result;
    (window: Window | null | undefined, options: Options): Result;
  }

  const dialog: {
    showOpenDialog: ShowDialog<OpenDialogOptions, Promise<{ canceled: boolean; filePaths: string[] }>>;
    showOpenDialogSync: ShowDialog<OpenDialogOptions, string[] | undefined>;
    showSaveDialog: ShowDialog<FileDialogOptions, Promise<{ canceled: boolean; filePath: string }>>;
    showSaveDialogSync: ShowDialog<FileDialogOptions, string>;
    showMessageBox: ShowDialog<MessageBoxOptions, Promise<{ response: number; checkboxChecked: boolean }>>;
    showMessageBoxSync: ShowDialog<MessageBoxOptions, number>;
    showErrorBox(title: string, content: string): void;
  };

  interface NativeImage {
    isEmpty(): boolean;
    getSize(): Size;
    getAspectRatio(): number;
    toPNG(): Buffer;
    /** @param quality From 0 to 100. */
    toJPEG(quality: number): Buffer;
    toDataURL(): string;
    resize(size: Partial<Size>): NativeImage;
    crop(rect: Rectangle): NativeImage;
    isTemplateImage(): boolean;
    setTemplateImage(on: boolean): void;
  }

  const nativeImage: {
    createEmpty(): NativeImage;
    createFromBuffer(bytes: Uint8Array): NativeImage;
    createFromDataURL(url: string): NativeImage;
    /** Empty if the file cannot be read. */
    createFromPath(path: string): NativeImage;
  };

  /** `"selection"` is the primary selection of X11 and Wayland. */
  type ClipboardType = "clipboard" | "selection";

  const clipboard: {
    readText(type?: ClipboardType): string;
    readImage(type?: ClipboardType): NativeImage;
    readHTML(type?: ClipboardType): string;
    readFilePaths(type?: ClipboardType): string[];
    write(data: { text?: string; html?: string }, type?: ClipboardType): void;
    writeText(text: string, type?: ClipboardType): void;
    writeImage(image: ImageSource, type?: ClipboardType): void;
    availableFormats(type?: ClipboardType): string[];
    clear(type?: ClipboardType): void;
  };

  const shell: {
    openExternal(url: string): Promise<void>;
    /** @returns An error message, or `""`. */
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
    trashItem(path: string): Promise<void>;
    beep(): void;
  };

  interface Display {
    id: number;
    bounds: Rectangle;
    workArea: Rectangle;
    size: Size;
    workAreaSize: Size;
    scaleFactor: number;
  }

  const screen: EventEmitter<
    Record<"display-added" | "display-removed" | "display-metrics-changed", [event: AppEvent, display: Display]>
  > & {
    getAllDisplays(): Display[];
    getPrimaryDisplay(): Display;
    getCursorScreenPoint(): Point;
    getDisplayNearestPoint(point: Point): Display;
    getDisplayMatching(rect: Rectangle): Display;
  };

  const nativeTheme: EventEmitter<{ updated: [] }> & {
    readonly shouldUseDarkColors: boolean;
    themeSource: "system" | "light" | "dark";
  };

  interface NotificationOptions {
    title?: string;
    subtitle?: string;
    body?: string;
    actions?: { type: "button"; text: string }[];
  }

  class Notification extends EventEmitter<{
    action: [event: AppEvent, index: number];
    click: [event: AppEvent];
    close: [event: AppEvent];
    show: [event: AppEvent];
  }> {
    static isSupported(): boolean;

    constructor(options?: NotificationOptions);

    title: string;
    subtitle: string;
    body: string;
    actions: NonNullable<NotificationOptions["actions"]>;

    show(): void;
    close(): void;
  }

  class Tray extends EventEmitter<
    Record<"click" | "right-click" | "double-click", [event: AppEvent, bounds: Rectangle, position: Point]>
  > {
    constructor(image: ImageSource);

    setImage(image: ImageSource): void;
    setToolTip(toolTip: string): void;
    setTitle(title: string): void;
    getTitle(): string;
    setContextMenu(menu: Menu | null): void;
    /** macOS only. */
    popUpContextMenu(menu?: Menu): void;
    /** macOS only. */
    closeContextMenu(): void;
    getBounds(): Rectangle;
    destroy(): void;
    isDestroyed(): boolean;
  }

  type ThermalState = "nominal" | "fair" | "serious" | "critical";

  const powerMonitor: EventEmitter<{
    "suspend": [];
    "resume": [];
    "thermal-state-change": [{ state: ThermalState }];
  }> & {
    readonly onBatteryPower: boolean;
    /** In seconds. */
    getSystemIdleTime(): number;
    getSystemIdleState(thresholdInSeconds: number): "active" | "idle" | "unknown";
    getCurrentThermalState(): ThermalState;
    isOnBatteryPower(): boolean;
  };

  const powerSaveBlocker: {
    start(type: "prevent-app-suspension"): number;
    stop(id: number): boolean;
    isStarted(id: number): boolean;
  };

  const globalShortcut: {
    /** `false` if the shortcut is taken. */
    register(accelerator: Accelerator, callback: () => void): boolean;
    registerAll(accelerators: Accelerator[], callback: () => void): void;
    isRegistered(accelerator: Accelerator): boolean;
    unregister(accelerator: Accelerator): void;
    unregisterAll(): void;
  };

  /** AES-256-GCM, with a key that {@link Bun.secrets} keeps. */
  const safeStorage: {
    /** `true` once one of the asynchronous methods has read the key. */
    isEncryptionAvailable(): boolean;
    isAsyncEncryptionAvailable(): Promise<boolean>;
    encryptString(text: string): Buffer;
    decryptString(encrypted: Uint8Array): string;
    encryptStringAsync(text: string): Promise<Buffer>;
    decryptStringAsync(encrypted: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>;
  };

  const systemPreferences: {
    getAnimationSettings(): { prefersReducedMotion: boolean; shouldRenderRichAnimation: boolean };
    isTrustedAccessibilityClient(prompt: boolean): boolean;
  };

  const net: {
    fetch: typeof fetch;
    isOnline(): boolean;
    readonly online: boolean;
  };

  type Key = string | number | bigint;

  interface VNode<Props = any> {
    readonly type: ElementType<Props>;
    readonly props: Props;
    readonly key: Key | null;
  }

  type Child = VNode | string | number | bigint | boolean | null | undefined | Iterable<Child>;
  type FunctionComponent<Props = {}> = (props: Props) => Child;
  type ComponentClass<Props = {}> = new (props: Props) => Component<Props, any>;
  type ComponentType<Props = {}> = FunctionComponent<Props> | ComponentClass<Props>;
  type ElementType<Props = any> = string | ComponentType<Props>;

  interface RefObject<T> {
    current: T;
  }
  type Ref<T> = RefObject<T | null> | ((instance: T | null) => void | (() => void)) | null;

  /** It is for JSX and cannot be called. */
  interface Context<T> extends FunctionComponent<{ value: T; children?: Child }> {
    Provider: Context<T>;
    Consumer: FunctionComponent<{ children(value: T): Child }>;
  }

  class Component<Props = {}, State = {}> {
    static contextType?: Context<any>;

    constructor(props: Props);

    readonly props: Readonly<Props>;
    state: Readonly<State>;
    context: unknown;

    setState(
      state: Partial<State> | null | ((previous: Readonly<State>, props: Readonly<Props>) => Partial<State> | null),
      callback?: () => void,
    ): void;
    forceUpdate(callback?: () => void): void;
    render(): Child;
    componentDidMount?(): void;
    shouldComponentUpdate?(props: Readonly<Props>, state: Readonly<State>): boolean;
    componentDidUpdate?(props: Readonly<Props>, state: Readonly<State>): void;
    componentWillUnmount?(): void;
    componentDidCatch?(error: unknown, info: object): void;
  }

  class PureComponent<Props = {}, State = {}> extends Component<Props, State> {}

  const Fragment: FunctionComponent<{ children?: Child }>;
  const StrictMode: FunctionComponent<{ children?: Child }>;
  const Suspense: FunctionComponent<{ fallback?: Child; children?: Child }>;

  const Children: {
    toArray(children: Child): Exclude<Child, boolean | null | undefined>[];
    map<T>(children: Child, callback: (child: Child, index: number) => T): T[];
    forEach(children: Child, callback: (child: Child, index: number) => void): void;
    count(children: Child): number;
    only(children: Child): VNode;
  };

  function createElement<Props>(type: ElementType<Props>, props?: Props | null, ...children: Child[]): VNode<Props>;
  function cloneElement<Props>(element: VNode<Props>, props?: Partial<Props>, ...children: Child[]): VNode<Props>;
  function isValidElement(value: unknown): value is VNode;
  function createContext<T>(defaultValue: T): Context<T>;
  function createRef<T>(): RefObject<T | null>;
  /** The container can be in another window. */
  function createPortal(children: Child, container: Dom<"Element">, key?: Key): VNode;
  function createRoot(container: Dom<"Element">): { render(children: Child): void; unmount(): void };
  function forwardRef<T, Props = {}>(
    render: (props: Props, ref: Ref<T>) => Child,
  ): FunctionComponent<Props & { ref?: Ref<T> }>;
  function memo<Props>(
    component: ComponentType<Props>,
    areEqual?: (previous: Props, next: Props) => boolean,
  ): FunctionComponent<Props>;
  function lazy<Props>(load: () => Promise<{ default: ComponentType<Props> }>): FunctionComponent<Props>;
  function flushSync<T = void>(callback?: () => T): T;
  function startTransition(callback: () => void): void;
  /** Runs `callback`, then the events, renders and effects that follow from it. For tests. */
  function act(callback: () => PromiseLike<unknown>): Promise<void>;
  function act(callback?: () => unknown): void;

  type Dependencies = readonly unknown[];
  type Effect = () => void | (() => void);

  function use<T>(usable: Context<T> | PromiseLike<T>): T;
  function useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void];
  function useState<T = undefined>(): [
    T | undefined,
    (next: T | undefined | ((previous: T | undefined) => T | undefined)) => void,
  ];
  function useReducer<State, Action>(
    reducer: (state: State, action: Action) => State,
    initial: State,
  ): [State, (action: Action) => void];
  function useReducer<State, Action, Argument>(
    reducer: (state: State, action: Action) => State,
    argument: Argument,
    initialize: (argument: Argument) => State,
  ): [State, (action: Action) => void];
  function useRef<T>(initial: T): RefObject<T>;
  function useRef<T>(initial: T | null): RefObject<T | null>;
  function useMemo<T>(compute: () => T, dependencies: Dependencies): T;
  function useCallback<T extends Function>(callback: T, dependencies: Dependencies): T;
  function useContext<T>(context: Context<T>): T;
  function useEffect(effect: Effect, dependencies?: Dependencies): void;
  function useLayoutEffect(effect: Effect, dependencies?: Dependencies): void;
  function useInsertionEffect(effect: Effect, dependencies?: Dependencies): void;
  function useEffectEvent<T extends Function>(callback: T): T;
  function useImperativeHandle<T>(ref: Ref<T> | undefined, create: () => T, dependencies?: Dependencies): void;
  function useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T;
  function useTransition(): [isPending: boolean, start: (callback: () => void | Promise<void>) => void];
  function useDeferredValue<T>(value: T): T;
  function useId(): string;
  function useDebugValue(value: unknown): void;
  /** The window that the component was rendered into with {@link Window.render}. */
  function useWindow(): Window;
  function useColorScheme(): "light" | "dark";

  type CSSProperties<Style = Dom<"CSSStyleDeclaration">> = {
    [Name in keyof Style as Style[Name] extends string ? Extract<Name, string> : never]?: string | number | null;
  } & { [custom: `--${string}` | `Webkit${string}`]: string | number | null | undefined };

  interface EventInterfaces {
    onAbort: "Event";
    onAnimationCancel: "AnimationEvent";
    onAnimationEnd: "AnimationEvent";
    onAnimationIteration: "AnimationEvent";
    onAnimationStart: "AnimationEvent";
    onAuxClick: "PointerEvent";
    onBeforeInput: "InputEvent";
    onBeforeToggle: "ToggleEvent";
    onBlur: "FocusEvent";
    onCancel: "Event";
    onChange: "Event";
    onClick: "PointerEvent";
    onClose: "Event";
    onCompositionEnd: "CompositionEvent";
    onCompositionStart: "CompositionEvent";
    onCompositionUpdate: "CompositionEvent";
    onContextMenu: "PointerEvent";
    onCopy: "ClipboardEvent";
    onCut: "ClipboardEvent";
    onDoubleClick: "MouseEvent";
    onDrag: "DragEvent";
    onDragEnd: "DragEvent";
    onDragEnter: "DragEvent";
    onDragLeave: "DragEvent";
    onDragOver: "DragEvent";
    onDragStart: "DragEvent";
    onDrop: "DragEvent";
    onError: "Event";
    onFocus: "FocusEvent";
    onGotPointerCapture: "PointerEvent";
    onInput: "Event";
    onInvalid: "Event";
    onKeyDown: "KeyboardEvent";
    onKeyPress: "KeyboardEvent";
    onKeyUp: "KeyboardEvent";
    onLoad: "Event";
    onLostPointerCapture: "PointerEvent";
    onMouseDown: "MouseEvent";
    onMouseEnter: "MouseEvent";
    onMouseLeave: "MouseEvent";
    onMouseMove: "MouseEvent";
    onMouseOut: "MouseEvent";
    onMouseOver: "MouseEvent";
    onMouseUp: "MouseEvent";
    onPaste: "ClipboardEvent";
    onPointerCancel: "PointerEvent";
    onPointerDown: "PointerEvent";
    onPointerEnter: "PointerEvent";
    onPointerLeave: "PointerEvent";
    onPointerMove: "PointerEvent";
    onPointerOut: "PointerEvent";
    onPointerOver: "PointerEvent";
    onPointerUp: "PointerEvent";
    onReset: "Event";
    onScroll: "Event";
    onScrollEnd: "Event";
    onSelect: "Event";
    onSubmit: "SubmitEvent";
    onToggle: "ToggleEvent";
    onTransitionCancel: "TransitionEvent";
    onTransitionEnd: "TransitionEvent";
    onTransitionRun: "TransitionEvent";
    onTransitionStart: "TransitionEvent";
    onWheel: "WheelEvent";
  }

  /**
   * They get the events of the DOM. As in React, `onChange` is for `input`, and `onFocus` and `onBlur` are for `focusin`
   * and `focusout`.
   */
  type EventProps<Element> = {
    [Name in keyof EventInterfaces as Name | `${Name}Capture`]?: (
      event: Dom<EventInterfaces[Name]> & { currentTarget: Element },
    ) => void;
  };

  type ElementProps<Element> = EventProps<Element> & {
    key?: Key | null;
    ref?: Ref<Element>;
    children?: Child;
    className?: string;
    style?: CSSProperties | string;
    dangerouslySetInnerHTML?: { __html: string };
    [attribute: string]: unknown;
  };

  interface ElementInterfaces {
    a: "HTMLAnchorElement";
    animate: "SVGAnimateElement";
    animateMotion: "SVGAnimateMotionElement";
    animateTransform: "SVGAnimateTransformElement";
    area: "HTMLAreaElement";
    audio: "HTMLAudioElement";
    base: "HTMLBaseElement";
    blockquote: "HTMLQuoteElement";
    body: "HTMLBodyElement";
    br: "HTMLBRElement";
    button: "HTMLButtonElement";
    canvas: "HTMLCanvasElement";
    caption: "HTMLTableCaptionElement";
    circle: "SVGCircleElement";
    clipPath: "SVGClipPathElement";
    col: "HTMLTableColElement";
    colgroup: "HTMLTableColElement";
    data: "HTMLDataElement";
    datalist: "HTMLDataListElement";
    defs: "SVGDefsElement";
    del: "HTMLModElement";
    desc: "SVGDescElement";
    details: "HTMLDetailsElement";
    dialog: "HTMLDialogElement";
    div: "HTMLDivElement";
    dl: "HTMLDListElement";
    ellipse: "SVGEllipseElement";
    embed: "HTMLEmbedElement";
    feBlend: "SVGFEBlendElement";
    feColorMatrix: "SVGFEColorMatrixElement";
    feComponentTransfer: "SVGFEComponentTransferElement";
    feComposite: "SVGFECompositeElement";
    feConvolveMatrix: "SVGFEConvolveMatrixElement";
    feDiffuseLighting: "SVGFEDiffuseLightingElement";
    feDisplacementMap: "SVGFEDisplacementMapElement";
    feDistantLight: "SVGFEDistantLightElement";
    feDropShadow: "SVGFEDropShadowElement";
    feFlood: "SVGFEFloodElement";
    feFuncA: "SVGFEFuncAElement";
    feFuncB: "SVGFEFuncBElement";
    feFuncG: "SVGFEFuncGElement";
    feFuncR: "SVGFEFuncRElement";
    feGaussianBlur: "SVGFEGaussianBlurElement";
    feImage: "SVGFEImageElement";
    feMerge: "SVGFEMergeElement";
    feMergeNode: "SVGFEMergeNodeElement";
    feMorphology: "SVGFEMorphologyElement";
    feOffset: "SVGFEOffsetElement";
    fePointLight: "SVGFEPointLightElement";
    feSpecularLighting: "SVGFESpecularLightingElement";
    feSpotLight: "SVGFESpotLightElement";
    feTile: "SVGFETileElement";
    feTurbulence: "SVGFETurbulenceElement";
    fieldset: "HTMLFieldSetElement";
    filter: "SVGFilterElement";
    foreignObject: "SVGForeignObjectElement";
    form: "HTMLFormElement";
    g: "SVGGElement";
    h1: "HTMLHeadingElement";
    h2: "HTMLHeadingElement";
    h3: "HTMLHeadingElement";
    h4: "HTMLHeadingElement";
    h5: "HTMLHeadingElement";
    h6: "HTMLHeadingElement";
    head: "HTMLHeadElement";
    hr: "HTMLHRElement";
    html: "HTMLHtmlElement";
    iframe: "HTMLIFrameElement";
    image: "SVGImageElement";
    img: "HTMLImageElement";
    input: "HTMLInputElement";
    ins: "HTMLModElement";
    label: "HTMLLabelElement";
    legend: "HTMLLegendElement";
    li: "HTMLLIElement";
    line: "SVGLineElement";
    linearGradient: "SVGLinearGradientElement";
    link: "HTMLLinkElement";
    map: "HTMLMapElement";
    marker: "SVGMarkerElement";
    mask: "SVGMaskElement";
    menu: "HTMLMenuElement";
    meta: "HTMLMetaElement";
    metadata: "SVGMetadataElement";
    meter: "HTMLMeterElement";
    mpath: "SVGMPathElement";
    object: "HTMLObjectElement";
    ol: "HTMLOListElement";
    optgroup: "HTMLOptGroupElement";
    option: "HTMLOptionElement";
    output: "HTMLOutputElement";
    p: "HTMLParagraphElement";
    path: "SVGPathElement";
    pattern: "SVGPatternElement";
    picture: "HTMLPictureElement";
    polygon: "SVGPolygonElement";
    polyline: "SVGPolylineElement";
    pre: "HTMLPreElement";
    progress: "HTMLProgressElement";
    q: "HTMLQuoteElement";
    radialGradient: "SVGRadialGradientElement";
    rect: "SVGRectElement";
    script: "HTMLScriptElement";
    select: "HTMLSelectElement";
    set: "SVGSetElement";
    slot: "HTMLSlotElement";
    source: "HTMLSourceElement";
    span: "HTMLSpanElement";
    stop: "SVGStopElement";
    style: "HTMLStyleElement";
    svg: "SVGSVGElement";
    switch: "SVGSwitchElement";
    symbol: "SVGSymbolElement";
    table: "HTMLTableElement";
    tbody: "HTMLTableSectionElement";
    td: "HTMLTableCellElement";
    template: "HTMLTemplateElement";
    text: "SVGTextElement";
    textPath: "SVGTextPathElement";
    textarea: "HTMLTextAreaElement";
    tfoot: "HTMLTableSectionElement";
    th: "HTMLTableCellElement";
    thead: "HTMLTableSectionElement";
    time: "HTMLTimeElement";
    title: "HTMLTitleElement";
    tr: "HTMLTableRowElement";
    track: "HTMLTrackElement";
    tspan: "SVGTSpanElement";
    ul: "HTMLUListElement";
    use: "SVGUseElement";
    video: "HTMLVideoElement";
    view: "SVGViewElement";
  }

  namespace JSX {
    type Element = VNode;
    type ElementType = string | ComponentType<any>;
    interface ElementAttributesProperty {
      props: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: Key | null;
    }
    interface IntrinsicClassAttributes<T> {
      ref?: Ref<T>;
    }
    type IntrinsicElements = {
      [Tag in keyof ElementInterfaces]: ElementProps<Dom<ElementInterfaces[Tag]>>;
    } & {
      [tag: string]: ElementProps<Dom<"HTMLElement">>;
    };
  }
}

/**
 * Makes `globalThis` a `window`, for libraries that are written for browsers, such as `react-dom`. Import it before them.
 * The first `Window` of `bun:desktop` shows the global `document`.
 *
 * @example
 * ```tsx
 * import "bun:desktop/dom";
 * import { Window } from "bun:desktop";
 * import { createRoot } from "react-dom/client";
 *
 * new Window({ title: "Hello" });
 * createRoot(document.body).render(<h1>Hello</h1>);
 * ```
 *
 * @experimental
 * @category Desktop
 */
declare module "bun:desktop/dom" {
  const window: import("bun:desktop").Window["window"];
  const document: import("bun:desktop").Window["document"];
}

/**
 * The API of Electron. Once this is loaded, `electron` resolves to it: use the types of that package.
 *
 * ```sh
 * bun --preload=bun:desktop/electron .
 * ```
 *
 * @experimental
 * @category Desktop
 */
declare module "bun:desktop/electron" {
  const electron: {
    app: Pick<typeof import("bun:desktop").app, "setWebEngine"> & {
      /**
       * Lets documents of these origins run in this process, where their scripts can do all that the app can.
       *
       * @param origins Such as `"app://bundle"`. `*` matches anything.
       */
      trustOrigins(
        origins: string[],
        options?: {
          /**
           * Frames and windows that pages open at trusted origins run in this process too, instead of in the web engine.
           * With URLs, such as `"https://example.com/embed/*"`: only the frames that show those.
           * @default false
           */
          inFrames?: boolean | string[];
          /**
           * Pages without a Content Security Policy run inline scripts that were not in the markup they came with.
           * @default false
           */
          injectedScripts?: boolean;
          /**
           * URLs at these origins that are for the web engine all the same, such as `"https://example.com/login*"`.
           * The window comes back with its cookies once it arrives at a trusted URL.
           */
          except?: string[];
          /**
           * Like `except`, but a trusted page that gets there with `history.pushState()` stays as it is.
           */
          exceptWhenLoaded?: string[];
        },
      ): void;
      /**
       * Where the scripts of pages are in an executable that `bun compile` has made.
       *
       * @param roots For the start of a URL, a directory such as `"/$bunfs/root/web/"`
       */
      setCompiledScripts(
        roots: Record<string, string>,
        options?: {
          /**
           * Pages in this process run these, the inline scripts in the markup they came with, and nothing else,
           * whatever their Content Security Policy says.
           * @default false
           */
          exclusive?: boolean;
          /**
           * The text of a module that was not compiled. It is interpreted, and can import the compiled files that
           * are entry points of the build. `undefined` loads the URL as usual.
           */
          source?: (url: string) => string | undefined | Promise<string | undefined>;
        },
      ): void;
      [member: string]: any;
    };
    [module: string]: any;
  };
  export default electron;
}

declare module "bun:desktop/jsx-runtime" {
  import type { ElementType, Key, VNode } from "bun:desktop";

  export { Fragment, JSX } from "bun:desktop";
  export function jsx<Props>(type: ElementType<Props>, props: Props, key?: Key): VNode<Props>;
  export { jsx as jsxs };
}

declare module "bun:desktop/jsx-dev-runtime" {
  export { Fragment, JSX } from "bun:desktop";
  export { jsx as jsxDEV } from "bun:desktop/jsx-runtime";
}
