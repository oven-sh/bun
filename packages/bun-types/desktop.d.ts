declare module "bun:desktop" {
  import type { EventEmitter } from "node:events";

  export type DesktopBackend =
    | "webkit"
    | "chrome"
    | "cef"
    | {
        type: "webkit" | "chrome" | "cef";
        path?: string;
        url?: string | false;
        args?: string[];
      };

  export interface BrowserWindowOptions {
    id?: string;
    backend?: DesktopBackend;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    title?: string;
    show?: boolean;
    resizable?: boolean;
    frame?: boolean;
    transparent?: boolean;
    preload?: string;
    nodeIntegration?: boolean;
    contextIsolation?: boolean;
    webPreferences?: {
      preload?: string;
      nodeIntegration?: boolean;
      contextIsolation?: boolean;
    };
  }

  export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface WebContents extends EventEmitter {
    readonly id: number;
    getURL(): string;
    getTitle(): string;
    openDevTools(options?: Record<string, unknown>): void;
    send(channel: string, ...args: unknown[]): void;
  }

  export class BrowserWindow extends EventEmitter {
    constructor(options?: BrowserWindowOptions);
    static getAllWindows(): BrowserWindow[];
    static getFocusedWindow(): BrowserWindow | null;
    static fromId(id: number): BrowserWindow | null;
    readonly id: number;
    readonly webContents: WebContents;
    loadURL(url: string, options?: Record<string, unknown>): Promise<void>;
    loadFile(filePath: string, options?: Record<string, unknown>): Promise<void>;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    close(): void;
    destroy(): void;
    isDestroyed(): boolean;
    setTitle(title: string): void;
    getTitle(): string;
    setSize(width: number, height: number): void;
    getSize(): [number, number];
    setPosition(x: number, y: number): void;
    getPosition(): [number, number];
    setBounds(bounds: Partial<Rectangle>): void;
    getBounds(): Rectangle;
    setMenu(menu: MenuInstance | null): void;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    minimize(): void;
    focus(): void;
    center(): void;
    setProgressBar(progress: number): void;
  }

  export type AppPathName =
    | "home"
    | "appData"
    | "userData"
    | "temp"
    | "exe"
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos"
    | "logs"
    | "cache";

  export interface App extends EventEmitter {
    name: string;
    readonly isPackaged: boolean;
    isReady(): boolean;
    whenReady(): Promise<void>;
    quit(): void;
    exit(exitCode?: number): void;
    getName(): string;
    setName(name: string): void;
    getVersion(): string;
    getPath(name: AppPathName): string;
    getAppPath(): string;
    requestSingleInstanceLock(): boolean;
    releaseSingleInstanceLock(): void;
    setAboutPanelOptions(options: Record<string, unknown>): void;
    setAsDefaultProtocolClient(scheme: string): boolean;
    setAppUserModelId(id: string): void;
    readonly commandLine: {
      appendSwitch(sw: string, value?: string): void;
      hasSwitch(sw: string): boolean;
      getSwitchValue(sw: string): string;
    };
    readonly dock: {
      setBadge(text: string): void;
      hide(): void;
      show(): void;
    };
  }

  export interface IpcMainInvokeEvent {
    senderId: number;
    sender: WebContents | undefined;
  }

  export interface IpcMain extends EventEmitter {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    handleOnce(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    removeHandler(channel: string): void;
  }

  export interface Protocol {
    handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
    unhandle(scheme: string): void;
    isProtocolHandled(scheme: string): boolean;
  }

  export interface MenuItemConstructorOptions {
    label?: string;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
    role?: string;
    accelerator?: string;
    submenu?: MenuItemConstructorOptions[];
    click?: () => void;
  }

  export interface MenuInstance {
    items: MenuItemConstructorOptions[];
    popup(): void;
  }

  export const Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]): MenuInstance;
    setApplicationMenu(menu: MenuInstance | null): void;
    getApplicationMenu(): MenuInstance | null;
  };

  export interface OpenDialogReturnValue {
    canceled: boolean;
    filePaths: string[];
  }

  export interface SaveDialogReturnValue {
    canceled: boolean;
    filePath?: string;
  }

  export interface MessageBoxReturnValue {
    response: number;
    checkboxChecked: boolean;
  }

  export const dialog: {
    showOpenDialog(
      winOrOpts?: BrowserWindow | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ): Promise<OpenDialogReturnValue>;
    showSaveDialog(
      winOrOpts?: BrowserWindow | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ): Promise<SaveDialogReturnValue>;
    showMessageBox(
      winOrOpts?: BrowserWindow | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ): Promise<MessageBoxReturnValue>;
    showErrorBox(title: string, content: string): void;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(fullPath: string): void;
    trashItem(fullPath: string): Promise<void>;
    beep(): void;
  };

  export const nativeTheme: EventEmitter & {
    themeSource: "system" | "light" | "dark";
    readonly shouldUseDarkColors: boolean;
    readonly shouldUseHighContrastColors: boolean;
    readonly shouldUseInvertedColorScheme: boolean;
  };

  export interface Display {
    id: number;
    bounds: Rectangle;
    workArea: Rectangle;
    scaleFactor: number;
  }

  export const screen: EventEmitter & {
    getPrimaryDisplay(): Display;
    getAllDisplays(): Display[];
    getDisplayNearestPoint(point: { x: number; y: number }): Display;
  };

  export const clipboard: {
    writeText(text: string): boolean;
    readText(): string;
    clear(): void;
    has(format?: string): boolean;
  };

  export interface NativeImage {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
  }

  export const nativeImage: {
    createFromPath(path: string): NativeImage;
    createFromBuffer(buffer: Uint8Array): NativeImage;
    createFromDataURL(dataURL: string): NativeImage;
    createEmpty(): NativeImage;
  };

  export class Notification extends EventEmitter {
    constructor(options?: { title?: string; body?: string });
    show(): void;
  }

  export const powerSaveBlocker: {
    start(type: "prevent-app-suspension" | "prevent-display-sleep"): number;
    stop(id: number): boolean;
    isStarted(id: number): boolean;
  };

  export const session: {
    defaultSession: {
      protocol: Protocol;
      webRequest: {
        onHeadersReceived(listener: (...args: any[]) => void): void;
      };
    };
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const app: App;
  export const ipcMain: IpcMain;
  export const protocol: Protocol;

  const desktop: {
    app: App;
    BrowserWindow: typeof BrowserWindow;
    ipcMain: IpcMain;
    protocol: Protocol;
    Menu: typeof Menu;
    dialog: typeof dialog;
    shell: typeof shell;
    nativeTheme: typeof nativeTheme;
    screen: typeof screen;
    clipboard: typeof clipboard;
    nativeImage: typeof nativeImage;
    Notification: typeof Notification;
    powerSaveBlocker: typeof powerSaveBlocker;
    session: typeof session;
    contextBridge: typeof contextBridge;
  };

  export default desktop;
}
