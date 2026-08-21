/**
 * Native macOS windows and controls from JavaScript.
 *
 * `bun:appkit` (also available as `Bun.AppKit`) creates real AppKit windows,
 * stacks, buttons, text fields, tables and menus without a web view. AppKit is
 * loaded on first use, so programs that never touch it pay nothing.
 *
 * Everything runs on the main JavaScript thread. While windows are open Bun's
 * event loop keeps running as usual: timers, `fetch`, sockets, workers and
 * subprocesses all continue to work. The process exits when the last window
 * closes and nothing else keeps the event loop alive (set
 * {@link App.keepAlive `app.keepAlive`} to stay running with no windows).
 *
 * While AppKit runs a tracking loop (an open menu, a window being live-resized)
 * JavaScript timers and I/O callbacks pause until it finishes.
 *
 * @example
 * ```ts
 * import { app, Window, VStack, Text, Button } from "bun:appkit";
 *
 * let count = 0;
 * const label = new Text({ text: "Count: 0", font: { size: 24, weight: "bold" } });
 * const button = new Button({
 *   title: "Increment",
 *   onClick() {
 *     label.text = `Count: ${++count}`;
 *   },
 * });
 *
 * const stack = new VStack({ padding: 20, spacing: 12 });
 * stack.append(label, button);
 *
 * const window = new Window({ title: "Counter", width: 300, height: 120, content: stack });
 * window.show();
 * ```
 *
 * On platforms other than macOS importing this module throws
 * `AppKit is only available on macOS`.
 *
 * @module bun:appkit
 */
declare module "bun:appkit" {
  /**
   * A dynamic system colour name. These follow the user's appearance
   * (light/dark mode, accent colour, increased contrast).
   */
  export type SystemColor =
    | "label"
    | "secondaryLabel"
    | "tertiaryLabel"
    | "quaternaryLabel"
    | "text"
    | "placeholder"
    | "link"
    | "separator"
    | "accent"
    | "control"
    | "controlText"
    | "controlBackground"
    | "windowBackground"
    | "underPageBackground"
    | "textBackground"
    | "selectedContentBackground"
    | "clear"
    | "black"
    | "white"
    | "gray"
    | "grey"
    | "red"
    | "orange"
    | "yellow"
    | "green"
    | "mint"
    | "teal"
    | "cyan"
    | "blue"
    | "indigo"
    | "purple"
    | "pink"
    | "brown";

  /**
   * A colour, written as a string.
   *
   * - `"#rgb"`, `"#rgba"`, `"#rrggbb"`, `"#rrggbbaa"` (sRGB)
   * - `"rgb(255, 128, 0)"`, `"rgba(255, 128, 0, 0.5)"` (channels 0–255 or percentages, alpha 0–1)
   * - a {@link SystemColor} name such as `"label"`, `"accent"`, `"red"` or `"windowBackground"`
   *
   * @example
   * ```ts
   * text.color = "secondaryLabel";
   * box.background = "#1e1e1eff";
   * box.border = { width: 1, color: "rgba(0, 0, 0, 0.2)" };
   * ```
   */
  export type Color = SystemColor | `#${string}` | `rgb(${string})` | `rgba(${string})` | (string & {});

  /**
   * A font weight: a CSS-style number from 100 to 900 (400 is regular) or a
   * name for one.
   */
  export type FontWeight =
    | 100
    | 200
    | 300
    | 400
    | 500
    | 600
    | 700
    | 800
    | 900
    | "ultralight"
    | "thin"
    | "light"
    | "regular"
    | "medium"
    | "semibold"
    | "bold"
    | "heavy"
    | "black";

  /** Which family of the system font to use. */
  export type FontDesign = "default" | "monospaced" | "rounded" | "serif";

  /**
   * A system font description. Every field is optional; missing fields use
   * the standard control font.
   */
  export interface FontSpec {
    /**
     * Point size. `0` or omitted means the standard system font size (13pt).
     * @default 0
     */
    size?: number;
    /**
     * @default "regular"
     */
    weight?: FontWeight;
    /**
     * @default "default"
     */
    design?: FontDesign;
    /**
     * @default false
     */
    italic?: boolean;
  }

  /**
   * A font: either just a point size, or a {@link FontSpec}.
   *
   * @example
   * ```ts
   * new Text({ text: "Title", font: { size: 20, weight: "semibold" } });
   * new Text({ text: "0x1f", font: { design: "monospaced" } });
   * new Text({ text: "small", font: 11 });
   * ```
   */
  export type Font = number | FontSpec;

  /** Edge insets in points. */
  export interface Insets {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
  }

  /**
   * Padding around a container's children: one number for all four edges, or
   * per-edge {@link Insets}.
   */
  export type Padding = number | Insets;

  /** A size in points. */
  export interface Size {
    width: number;
    height: number;
  }

  /** A point in screen or view coordinates (origin bottom-left, as AppKit has it). */
  export interface Point {
    x: number;
    y: number;
  }

  /** A rectangle in points. */
  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  /**
   * How a {@link VStack}/{@link HStack} places children on the cross axis.
   *
   * - `"fill"` stretches each child across the stack.
   * - `"leading"`/`"trailing"` apply to a `VStack`; `"top"`/`"bottom"`/
   *   `"firstBaseline"`/`"lastBaseline"` apply to an `HStack`; `"center"` to both.
   */
  export type Align = "fill" | "leading" | "center" | "trailing" | "top" | "bottom" | "firstBaseline" | "lastBaseline";

  /**
   * How a stack distributes children along its own axis
   * (`NSStackViewDistribution`).
   *
   * - `"fill"`: children keep their natural size; {@link View.grow `grow`}
   *   decides which child takes leftover space.
   * - `"fillEqually"`: every child gets the same length.
   * - `"fillProportionally"`: lengths proportional to natural sizes.
   * - `"equalSpacing"`: natural sizes, equal gaps.
   * - `"equalCentering"`: natural sizes, equal distance between centres.
   * - `"gravity"`: pack children at the leading edge.
   */
  export type Distribution =
    | "fill"
    | "fillEqually"
    | "fillProportionally"
    | "equalSpacing"
    | "equalCentering"
    | "gravity";

  /** Horizontal alignment of text inside a {@link Text} or text field. */
  export type TextAlign = "left" | "center" | "right" | "justified" | "natural";

  /**
   * The look and role of a {@link Button}.
   *
   * - `"default"`: a rounded push button.
   * - `"primary"`: the window's default button; Return activates it and it is
   *   drawn in the accent colour.
   * - `"destructive"`: marks a destructive action.
   * - `"link"`: borderless, like a hyperlink.
   * - `"toolbar"`: a square toolbar-style bezel.
   */
  export type ButtonKind = "default" | "primary" | "destructive" | "link" | "toolbar";

  /**
   * How an {@link Image} scales its picture to the view's bounds.
   *
   * - `"down"`: shrink proportionally to fit, never enlarge.
   * - `"fit"`: scale proportionally up or down to fit.
   * - `"fill"`: stretch each axis independently.
   * - `"none"`: draw at natural size.
   */
  export type ImageScaling = "down" | "fit" | "fill" | "none";

  /**
   * What an {@link Image} shows.
   *
   * - `{ symbol }`: an SF Symbol by name, e.g. `"star.fill"`.
   * - `{ file }`: an image file on disk (PNG, JPEG, HEIC, PDF, …).
   * - `{ data }`: encoded image bytes.
   */
  export type ImageSource = { symbol: string } | { file: string } | { data: Uint8Array | ArrayBuffer };

  /**
   * The application's presence on screen (`NSApplicationActivationPolicy`).
   *
   * - `"regular"`: a normal app with a Dock icon and a menu bar.
   * - `"accessory"`: no Dock icon and no menu bar, but can show windows and be
   *   activated. Good for utilities and tests.
   * - `"background"`: no user interface at all.
   */
  export type ActivationPolicy = "regular" | "accessory" | "background";

  /**
   * One item in a menu.
   *
   * @example
   * ```ts
   * const save: MenuItem = { title: "Save", key: "s", onClick: () => save() };
   * const copy: MenuItem = { title: "Copy", key: "c", action: "copy:" };
   * ```
   */
  export interface MenuItem {
    /** The text shown for the item. */
    title: string;
    /**
     * Called when the item is chosen. The app also emits a `"menu"` event with
     * this item.
     */
    onClick?: () => void;
    /**
     * Instead of a callback, the name of a standard AppKit responder-chain
     * action to send to the focused view or window, exactly as the built-in
     * menus do. Examples: `"copy:"`, `"paste:"`, `"selectAll:"`, `"undo:"`,
     * `"performClose:"`, `"performMiniaturize:"`, `"toggleFullScreen:"`,
     * `"hide:"`, `"terminate:"`. AppKit enables and disables such items
     * automatically depending on what has focus.
     */
    action?: string;
    /**
     * Key equivalent, a single character such as `"s"` or `","`. Command is
     * implied unless {@link MenuItem.command `command`} is `false`; an
     * upper-case letter implies Shift.
     */
    key?: string;
    /** Add Shift to the key equivalent. @default false */
    shift?: boolean;
    /** Add Option (Alt) to the key equivalent. @default false */
    option?: boolean;
    /** Add Control to the key equivalent. @default false */
    control?: boolean;
    /**
     * Whether Command is part of the key equivalent.
     * @default true when `key` is set
     */
    command?: boolean;
    /**
     * Whether the item can be chosen. Items with an `action` are validated by
     * AppKit instead.
     * @default true
     */
    enabled?: boolean;
    /** Nested items shown as a submenu of this item. */
    submenu?: ReadonlyArray<MenuItem | "separator">;
  }

  /**
   * One top-level menu in the menu bar. The first menu in {@link App.menu} is
   * always the application menu (macOS shows it under the app's name whatever
   * its `title`).
   */
  export interface MenuSpec {
    title: string;
    items: ReadonlyArray<MenuItem | "separator">;
  }

  /** Passed to `"beforequit"` listeners. */
  export interface QuitEvent {
    /** Keep the app running: windows stay open and the quit is abandoned. */
    preventDefault(): void;
  }

  export interface AppEventMap {
    /**
     * The user asked to quit (Cmd-Q, the Dock menu, or {@link App.quit}).
     * Call `event.preventDefault()` to cancel; otherwise every window is
     * closed and the process exits once nothing else keeps it alive, running
     * the usual `beforeExit`/`exit` process events.
     */
    beforequit: [event: QuitEvent];
    /**
     * The Dock icon was clicked while the app was already running.
     * `hasVisibleWindows` is what AppKit reports; a typical handler shows a
     * window when it is `false`.
     */
    reopen: [hasVisibleWindows: boolean];
    /** A custom menu item (one with an `onClick` or no `action`) was chosen. */
    menu: [item: MenuItem];
  }

  /**
   * The application object. AppKit starts lazily the first time a
   * {@link Window} is created or {@link App.activate} is called; set
   * {@link App.activationPolicy} and {@link App.name} before that if you
   * want to change them.
   */
  export interface App {
    /**
     * The name used in the application menu ("About …", "Quit …"). Defaults to
     * the process name.
     */
    name: string;
    /**
     * @default "regular"
     */
    activationPolicy: ActivationPolicy;
    /**
     * Keep the process alive even when no window is open (for menu-bar style
     * utilities, or apps that reopen a window from the Dock).
     * @default false
     */
    keepAlive: boolean;
    /** Text drawn on the Dock tile, or `null` for none. */
    badge: string | null;
    /**
     * The menu bar. `null` installs the standard application, Edit, View and
     * Window menus so text editing shortcuts, full screen and Cmd-Q work out
     * of the box; an array replaces the whole menu bar.
     *
     * @example
     * ```ts
     * app.menu = [
     *   { title: app.name, items: [{ title: `Quit ${app.name}`, key: "q", action: "terminate:" }] },
     *   { title: "File", items: [{ title: "New", key: "n", onClick: () => newDocument() }, "separator", { title: "Close", key: "w", action: "performClose:" }] },
     *   { title: "Edit", items: [{ title: "Copy", key: "c", action: "copy:" }, { title: "Paste", key: "v", action: "paste:" }] },
     * ];
     * ```
     * @default null
     */
    menu: MenuSpec[] | null;
    /** Every window that has been created and not yet closed. */
    readonly windows: readonly Window[];
    /** Whether the app's effective appearance is dark. */
    readonly isDark: boolean;
    /**
     * `false` when no screen is attached (over `ssh`, on CI agents, inside a
     * sandbox). Windows still work there — layout, events and `snapshot()` —
     * but nothing is ever shown. Starts the application if it has not been.
     */
    readonly hasDisplay: boolean;
    /** Number of native views currently alive. Intended for leak tests. */
    readonly liveViews: number;
    /** Start AppKit if needed and bring the app to the foreground. */
    activate(): void;
    /** Hide every window of the app (like Cmd-H). */
    hide(): void;
    /**
     * Ask to quit: emits `"beforequit"`, then closes every window. The process
     * exits through Bun's normal shutdown once nothing keeps it alive.
     */
    quit(): void;
    on<K extends keyof AppEventMap>(event: K, listener: (...args: AppEventMap[K]) => void): this;
    off<K extends keyof AppEventMap>(event: K, listener: (...args: AppEventMap[K]) => void): this;
  }

  /**
   * The shared application.
   *
   * @example
   * ```ts
   * import { app } from "bun:appkit";
   * app.activationPolicy = "accessory"; // no Dock icon
   * app.on("beforequit", e => {
   *   if (hasUnsavedChanges()) e.preventDefault();
   * });
   * ```
   */
  export const app: App;

  /**
   * Options for {@link Window}. Sizes are the content size in points,
   * excluding the title bar.
   */
  export interface WindowOptions {
    /** @default "" */
    title?: string;
    /** Content width. @default 480 */
    width?: number;
    /** Content height. @default 320 */
    height?: number;
    /** Screen x of the window's bottom-left corner. Omit both `x` and `y` to centre. */
    x?: number;
    /** Screen y of the window's bottom-left corner (origin at the bottom of the screen). */
    y?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    /** @default true */
    resizable?: boolean;
    /** @default true */
    closable?: boolean;
    /** @default true */
    minimizable?: boolean;
    /**
     * Let the content extend under the title bar (`NSWindowStyleMaskFullSizeContentView`).
     * @default false
     */
    fullSizeContent?: boolean;
    /** @default false */
    titlebarTransparent?: boolean;
    /** Hide the title text (the bar itself stays). @default false */
    titleHidden?: boolean;
    /** Window background colour. @default "windowBackground" */
    background?: Color;
    /**
     * A name under which AppKit saves and restores the window's frame between
     * launches (`setFrameAutosaveName:`).
     */
    restoreName?: string;
    /** The root view. Same as assigning {@link Window.content} afterwards. */
    content?: View | null;
    /** Show the window as soon as it is created. @default true */
    visible?: boolean;
    /** See {@link Window.onClose}. */
    onClose?: Window["onClose"];
    /** See {@link Window.shouldClose}. */
    shouldClose?: Window["shouldClose"];
    /** See {@link Window.onResize}. */
    onResize?: Window["onResize"];
    /** See {@link Window.onMove}. */
    onMove?: Window["onMove"];
    /** See {@link Window.onFocus}. */
    onFocus?: Window["onFocus"];
    /** See {@link Window.onBlur}. */
    onBlur?: Window["onBlur"];
  }

  /**
   * A native window. Creating one starts AppKit if it has not started yet.
   * A window is shown as soon as it is created unless `visible: false` is
   * passed; call {@link Window.show} to show it later.
   *
   * The root {@link Window.content view} is pinned to the window's edges. A
   * `VStack` whose children do not {@link View.grow grow} sits at the top at
   * its natural height; a `ScrollView`, `SplitView` or growing stack fills
   * the window.
   *
   * @example
   * ```ts
   * const win = new Window({
   *   title: "Hello",
   *   width: 400,
   *   height: 200,
   *   content: new Text({ text: "Hello from AppKit" }),
   *   onClose() {
   *     console.log("closed");
   *   },
   * });
   * ```
   *
   * @category AppKit
   */
  export class Window {
    constructor(options?: WindowOptions);
    title: string;
    /** Content width in points. */
    width: number;
    /** Content height in points. */
    height: number;
    /** Screen x of the bottom-left corner. */
    x: number;
    /** Screen y of the bottom-left corner. */
    y: number;
    minWidth: number;
    minHeight: number;
    /** The root view, or `null` for an empty window. */
    content: View | null;
    /** Whether the window is on screen. Assigning calls {@link Window.show} or {@link Window.hide}. */
    visible: boolean;
    /** Whether the window has been closed. A closed window cannot be shown again. */
    readonly closed: boolean;
    /** Whether this is the key window (the one receiving keyboard input). */
    readonly key: boolean;
    /** Put the window on screen and make it key. Activates the app on first show. */
    show(): void;
    /** Take the window off screen without closing it. */
    hide(): void;
    /** Centre the window on its screen. */
    center(): void;
    /** Make the window key and bring it to the front. */
    focus(): void;
    /**
     * Close the window. {@link Window.onClose} fires; when this was the last
     * open window and {@link App.keepAlive} is `false` the process can exit.
     * Calling `close()` again does nothing.
     */
    close(): void;
    /**
     * PNG bytes of the window's current contents, or `null` when it has no
     * backing store yet (never shown) or there is no window server.
     */
    snapshot(): Uint8Array | null;
    /** Called after the window has closed, whether by the user or by {@link Window.close}. */
    onClose: (() => void) | undefined;
    /**
     * Called when the user clicks the close button. Return `false` to keep the
     * window open. Not consulted by {@link Window.close}.
     */
    shouldClose: (() => boolean) | undefined;
    /** Called with the new content size after the window is resized. */
    onResize: ((size: Size) => void) | undefined;
    /** Called with the new bottom-left screen position after the window moves. */
    onMove: ((position: Point) => void) | undefined;
    /** Called when the window becomes the key window. */
    onFocus: (() => void) | undefined;
    /** Called when the window stops being the key window. */
    onBlur: (() => void) | undefined;
  }

  /**
   * A border drawn inside a view's edge.
   */
  export interface Border {
    /** Line width in points. @default 1 */
    width?: number;
    /** @default "separator" */
    color?: Color | null;
  }

  /**
   * Properties every view has. All sizes are in points.
   */
  export interface ViewProps {
    /**
     * Hidden views take no space in a stack.
     * @default false
     */
    hidden?: boolean;
    /**
     * Opacity from 0 to 1.
     * @default 1
     */
    alpha?: number;
    /** Help text shown on hover. @default null */
    tooltip?: string | null;
    /** An identifier for the view (its accessibility identifier). @default null */
    id?: string | null;
    /** Fixed width, or `null` for natural width. @default null */
    width?: number | null;
    /** Fixed height, or `null` for natural height. @default null */
    height?: number | null;
    /** @default null */
    minWidth?: number | null;
    /** @default null */
    maxWidth?: number | null;
    /** @default null */
    minHeight?: number | null;
    /** @default null */
    maxHeight?: number | null;
    /**
     * How eagerly the view takes leftover space along its parent stack's
     * axis. `0` keeps the natural size; among siblings, larger values stretch
     * first. In the window's root, a growing view fills the window.
     * @default 0
     */
    grow?: number;
    /** Fill colour behind the view's content. @default null */
    background?: Color | null;
    /** Rounds the view's corners (and clips the background to them). @default 0 */
    cornerRadius?: number;
    /** @default null */
    border?: Border | null;
  }

  /**
   * Base class of every view. Not constructible directly; use one of the
   * concrete views below.
   *
   * @category AppKit
   */
  export abstract class View {
    hidden: boolean;
    alpha: number;
    tooltip: string | null;
    id: string | null;
    width: number | null;
    height: number | null;
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
    grow: number;
    background: Color | null;
    cornerRadius: number;
    border: Border | null;
    /** The container this view is in, or `null`. */
    readonly parent: Container | null;
    /** The window this view is shown in, or `null` when not mounted. */
    readonly window: Window | null;
    /**
     * The view's frame in its parent's coordinates after the last layout
     * pass. All zeros before the view has been laid out.
     */
    readonly frame: Rect;
    /** Remove the view from its parent (no-op when it has none). */
    remove(): void;
    /** PNG bytes of the view as currently drawn, or `null` before it has a size. */
    snapshot(): Uint8Array | null;
  }

  /**
   * A view that holds other views.
   *
   * @category AppKit
   */
  export abstract class Container extends View {
    /** Child views in display order. */
    readonly children: readonly View[];
    /** Add views at the end. A view can only be in one container at a time. */
    append(...views: View[]): void;
    /** Insert `view` before `ref`, or at the end when `ref` is `null`. */
    insertBefore(view: View, ref: View | null): void;
    /** Remove a direct child. */
    removeChild(view: View): void;
    /** Remove every child, then append `views`. */
    replaceChildren(...views: View[]): void;
  }

  /** Properties shared by {@link VStack}, {@link HStack} and {@link Group}. */
  export interface StackProps extends ViewProps {
    /** Gap between adjacent children. @default 8 */
    spacing?: number;
    /** Inset between the stack's edges and its children. @default 0 */
    padding?: Padding;
    /**
     * Cross-axis placement of children.
     * @default "fill" for VStack and Group, "center" for HStack
     */
    align?: Align;
    /** @default "fill" */
    distribution?: Distribution;
  }

  export interface VStackProps extends StackProps {}
  export interface HStackProps extends StackProps {}

  /**
   * Lays children out top to bottom.
   *
   * @example
   * ```ts
   * const form = new VStack({ spacing: 12, padding: 20 });
   * form.append(new TextField({ placeholder: "Name" }), new Button({ title: "OK", kind: "primary" }));
   * ```
   *
   * @category AppKit
   */
  export class VStack extends Container {
    constructor(props?: VStackProps);
    spacing: number;
    padding: Padding;
    align: Align;
    distribution: Distribution;
  }

  /**
   * Lays children out leading to trailing.
   *
   * @category AppKit
   */
  export class HStack extends Container {
    constructor(props?: HStackProps);
    spacing: number;
    padding: Padding;
    align: Align;
    distribution: Distribution;
  }

  export interface ZStackProps extends ViewProps {}

  /**
   * A plain view that pins every child to its own edges, so children overlap
   * and each fills the container. Useful as a backdrop or to swap content.
   *
   * @category AppKit
   */
  export class ZStack extends Container {
    constructor(props?: ZStackProps);
  }

  export interface GroupProps extends StackProps {
    /** Title drawn above the box. Empty for none. @default "" */
    title?: string;
    /** Inset between the box's border and its children. @default 4 */
    padding?: Padding;
  }

  /**
   * A titled box (`NSBox`) whose children are stacked vertically.
   *
   * @category AppKit
   */
  export class Group extends Container {
    constructor(props?: GroupProps);
    title: string;
    spacing: number;
    padding: Padding;
    align: Align;
    distribution: Distribution;
  }

  export interface ScrollBars {
    /** @default false */
    horizontal?: boolean;
    /** @default true */
    vertical?: boolean;
  }

  export interface ScrollViewProps extends ViewProps {
    /** Which scrollers to show (they auto-hide when not needed). */
    scrollBars?: ScrollBars;
  }

  /**
   * Scrolls a single child that is larger than the view. Content starts at
   * the top.
   *
   * @example
   * ```ts
   * const list = new VStack({ spacing: 4, padding: 8 });
   * for (let i = 0; i < 100; i++) list.append(new Text({ text: `Row ${i}` }));
   * const scroll = new ScrollView({ grow: 1 });
   * scroll.append(list);
   * ```
   *
   * @category AppKit
   */
  export class ScrollView extends Container {
    constructor(props?: ScrollViewProps);
    scrollBars: ScrollBars;
  }

  export interface SplitViewProps extends ViewProps {
    /**
     * `false` puts panes side by side with vertical dividers; `true` stacks
     * them top to bottom.
     * @default false
     */
    vertical?: boolean;
  }

  /**
   * Resizable panes separated by draggable dividers; each child is one pane.
   *
   * @category AppKit
   */
  export class SplitView extends Container {
    constructor(props?: SplitViewProps);
    vertical: boolean;
  }

  export interface TextProps extends ViewProps {
    /** @default "" */
    text?: string;
    /** @default null (the standard label font) */
    font?: Font | null;
    /** @default null ("label") */
    color?: Color | null;
    /** @default "natural" */
    textAlign?: TextAlign;
    /** Let the user select and copy the text. @default false */
    selectable?: boolean;
    /**
     * Maximum number of lines; longer text is truncated with an ellipsis. `0`
     * wraps onto as many lines as needed.
     * @default 1
     */
    lineLimit?: number;
  }

  /**
   * A non-editable text label.
   *
   * @example
   * ```ts
   * new Text({ text: "Settings", font: { size: 18, weight: "semibold" } });
   * new Text({ text: longHelpText, lineLimit: 0, color: "secondaryLabel" });
   * ```
   *
   * @category AppKit
   */
  export class Text extends View {
    constructor(props?: TextProps);
    text: string;
    font: Font | null;
    color: Color | null;
    textAlign: TextAlign;
    selectable: boolean;
    lineLimit: number;
  }

  export interface ButtonProps extends ViewProps {
    /** @default "" */
    title?: string;
    /** @default "default" */
    kind?: ButtonKind;
    /** @default true */
    enabled?: boolean;
    /** An SF Symbol name drawn before the title, e.g. `"plus"`. @default null */
    symbol?: string | null;
    /**
     * Key that activates the button while its window is key, e.g. `"\r"`
     * (Return) or `"\u001b"` (Escape). `null` leaves it to `kind`: Return
     * for `"primary"`, none otherwise.
     * @default null
     */
    keyEquivalent?: string | null;
    /** @default null (the standard control font) */
    font?: Font | null;
    /** Tint for the title and symbol. @default null */
    tint?: Color | null;
    /** Called when the button is clicked or its key equivalent is pressed. */
    onClick?: () => void;
  }

  /**
   * A push button.
   *
   * @example
   * ```ts
   * new Button({ title: "Save", kind: "primary", onClick: () => save() });
   * new Button({ symbol: "trash", kind: "destructive", onClick: () => remove() });
   * ```
   *
   * @category AppKit
   */
  export class Button extends View {
    constructor(props?: ButtonProps);
    title: string;
    kind: ButtonKind;
    enabled: boolean;
    symbol: string | null;
    keyEquivalent: string | null;
    font: Font | null;
    tint: Color | null;
    onClick: (() => void) | undefined;
    /** Act as if the user clicked the button (highlights, then fires `onClick`). */
    click(): void;
  }

  export interface ToggleProps extends ViewProps {
    /** @default "" */
    title?: string;
    /** @default false */
    checked?: boolean;
    /** @default true */
    enabled?: boolean;
    /** @default null (the standard control font) */
    font?: Font | null;
  }

  export interface CheckboxProps extends ToggleProps {
    /** Called with the new state after the user toggles the checkbox. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * A checkbox with a title.
   *
   * @example
   * ```ts
   * new Checkbox({ title: "Remember me", checked: true, onChange: on => console.log(on) });
   * ```
   *
   * @category AppKit
   */
  export class Checkbox extends View {
    constructor(props?: CheckboxProps);
    title: string;
    /** The current state, as the user left it. */
    checked: boolean;
    enabled: boolean;
    font: Font | null;
    onChange: ((checked: boolean) => void) | undefined;
    /** Toggle as if clicked. */
    click(): void;
  }

  export interface RadioProps extends ToggleProps {
    /** Called with the new state after the user clicks the radio button. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * A radio button with a title. Grouping is up to you: clear the others in
   * `onChange`.
   *
   * @category AppKit
   */
  export class Radio extends View {
    constructor(props?: RadioProps);
    title: string;
    checked: boolean;
    enabled: boolean;
    font: Font | null;
    onChange: ((checked: boolean) => void) | undefined;
    click(): void;
  }

  export interface SwitchProps extends ViewProps {
    /** @default false */
    checked?: boolean;
    /** Called with the new state after the user flips the switch. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * An on/off switch (`NSSwitch`).
   *
   * @category AppKit
   */
  export class Switch extends View {
    constructor(props?: SwitchProps);
    checked: boolean;
    onChange: ((checked: boolean) => void) | undefined;
    click(): void;
  }

  export interface TextFieldProps extends ViewProps {
    /** @default "" */
    value?: string;
    /** Greyed hint shown while empty. @default null */
    placeholder?: string | null;
    /** @default true */
    editable?: boolean;
    /** @default true */
    enabled?: boolean;
    /** @default null */
    font?: Font | null;
    /** @default "natural" */
    textAlign?: TextAlign;
    /**
     * `true` calls `onChange` on every keystroke; `false` only when editing
     * ends.
     * @default true
     */
    continuous?: boolean;
    /**
     * Called with the field's text when the user changes it. Assigning
     * {@link TextField.value} from code does not call it.
     */
    onChange?: (value: string) => void;
    /** Called with the field's text when the user presses Return. */
    onSubmit?: (value: string) => void;
    /** Called when the field starts editing (gains keyboard focus and the user types). */
    onFocus?: () => void;
    /** Called when editing ends (focus leaves the field or Return is pressed). */
    onBlur?: () => void;
  }

  /**
   * A single-line text input.
   *
   * @example
   * ```ts
   * const name = new TextField({
   *   placeholder: "Your name",
   *   onChange(value) {
   *     greeting.text = `Hello, ${value}`;
   *   },
   *   onSubmit(value) {
   *     submit(value);
   *   },
   * });
   * ```
   *
   * @category AppKit
   */
  export class TextField extends View {
    constructor(props?: TextFieldProps);
    /** The current text, including edits the user has made. */
    value: string;
    placeholder: string | null;
    editable: boolean;
    enabled: boolean;
    font: Font | null;
    textAlign: TextAlign;
    continuous: boolean;
    onChange: ((value: string) => void) | undefined;
    onSubmit: ((value: string) => void) | undefined;
    onFocus: (() => void) | undefined;
    onBlur: (() => void) | undefined;
  }

  export interface SecureFieldProps extends TextFieldProps {}

  /**
   * A password input that shows bullets instead of the text.
   *
   * @category AppKit
   */
  export class SecureField extends TextField {
    constructor(props?: SecureFieldProps);
  }

  export interface SearchFieldProps extends TextFieldProps {}

  /**
   * A rounded search input with a magnifier icon and a clear button.
   *
   * @category AppKit
   */
  export class SearchField extends TextField {
    constructor(props?: SearchFieldProps);
  }

  export interface TextEditorProps extends ViewProps {
    /** @default "" */
    value?: string;
    /** @default true */
    editable?: boolean;
    /** @default null (the standard system font; pass `{ design: "monospaced" }` for code) */
    font?: Font | null;
    /** Text colour. @default null (the system text colour) */
    color?: Color | null;
    /**
     * Called with the full text after each user edit. Assigning
     * {@link TextEditor.value} from code does not call it.
     */
    onChange?: (value: string) => void;
  }

  /**
   * A multi-line, scrolling plain-text editor with undo. Give it a size or
   * `grow` so it has room.
   *
   * @example
   * ```ts
   * new TextEditor({ value: source, font: { design: "monospaced", size: 12 }, grow: 1 });
   * ```
   *
   * @category AppKit
   */
  export class TextEditor extends View {
    constructor(props?: TextEditorProps);
    /** The current text, including edits the user has made. */
    value: string;
    editable: boolean;
    font: Font | null;
    color: Color | null;
    onChange: ((value: string) => void) | undefined;
  }

  export interface SliderProps extends ViewProps {
    /** @default 0 */
    value?: number;
    /** @default 0 */
    min?: number;
    /** @default 1 */
    max?: number;
    /**
     * Snap to multiples of `step` (and show tick marks). `0` allows any value.
     * @default 0
     */
    step?: number;
    /**
     * `true` calls `onChange` continuously while dragging; `false` once on
     * release.
     * @default true
     */
    continuous?: boolean;
    /** Called with the new value when the user moves the slider. */
    onChange?: (value: number) => void;
  }

  /**
   * A horizontal slider.
   *
   * @example
   * ```ts
   * new Slider({ min: 0, max: 100, step: 1, value: 50, onChange: v => (label.text = String(v)) });
   * ```
   *
   * @category AppKit
   */
  export class Slider extends View {
    constructor(props?: SliderProps);
    /** The current value, as the user left it. */
    value: number;
    min: number;
    max: number;
    step: number;
    continuous: boolean;
    onChange: ((value: number) => void) | undefined;
  }

  export interface PickerProps extends ViewProps {
    /** The choices, in order. @default [] */
    items?: readonly string[];
    /** Index of the selected item, `-1` for none. @default 0 */
    selectedIndex?: number;
    /** Called with the index the user picked. */
    onChange?: (index: number) => void;
  }

  /**
   * A pop-up button that picks one item from a list.
   *
   * @example
   * ```ts
   * new Picker({ items: ["Small", "Medium", "Large"], selectedIndex: 1, onChange: i => setSize(i) });
   * ```
   *
   * @category AppKit
   */
  export class Picker extends View {
    constructor(props?: PickerProps);
    items: readonly string[];
    /** The selected index as the user left it, `-1` for none. */
    selectedIndex: number;
    onChange: ((index: number) => void) | undefined;
  }

  export interface SegmentedProps extends ViewProps {
    /** One label per segment. @default [] */
    items?: readonly string[];
    /** Index of the selected segment, `-1` for none. @default 0 */
    selectedIndex?: number;
    /** Called with the index of the segment the user clicked. */
    onChange?: (index: number) => void;
  }

  /**
   * A segmented control that selects one of a few options.
   *
   * @category AppKit
   */
  export class Segmented extends View {
    constructor(props?: SegmentedProps);
    items: readonly string[];
    selectedIndex: number;
    onChange: ((index: number) => void) | undefined;
  }

  export interface ProgressProps extends ViewProps {
    /** @default 0 */
    value?: number;
    /** @default 0 */
    min?: number;
    /** @default 100 */
    max?: number;
    /**
     * Show indefinite activity instead of `value`.
     * @default false
     */
    indeterminate?: boolean;
    /**
     * Animate the indeterminate bar or spinner.
     * @default true
     */
    running?: boolean;
    /**
     * Draw as a circular spinner instead of a bar.
     * @default false
     */
    spinner?: boolean;
  }

  /**
   * A progress bar or spinner.
   *
   * @example
   * ```ts
   * const bar = new Progress({ max: files.length });
   * for (const [i, file] of files.entries()) {
   *   await upload(file);
   *   bar.value = i + 1;
   * }
   * new Progress({ spinner: true, indeterminate: true }); // busy indicator
   * ```
   *
   * @category AppKit
   */
  export class Progress extends View {
    constructor(props?: ProgressProps);
    value: number;
    min: number;
    max: number;
    indeterminate: boolean;
    running: boolean;
    spinner: boolean;
  }

  export interface ImageProps extends ViewProps {
    /** @default null */
    image?: ImageSource | null;
    /** @default "down" */
    scaling?: ImageScaling;
    /** Tint for template images and SF Symbols. @default null */
    tint?: Color | null;
    /** Point size for an SF Symbol. @default 0 (the symbol's natural size) */
    size?: number;
  }

  /**
   * Displays an image file, image bytes, or an SF Symbol.
   *
   * @example
   * ```ts
   * new Image({ image: { symbol: "checkmark.circle.fill" }, tint: "green", size: 32 });
   * new Image({ image: { file: "./logo.png" }, width: 64, height: 64, scaling: "fit" });
   * new Image({ image: { data: await Bun.file("photo.jpg").bytes() } });
   * ```
   *
   * @category AppKit
   */
  export class Image extends View {
    constructor(props?: ImageProps);
    image: ImageSource | null;
    scaling: ImageScaling;
    tint: Color | null;
    size: number;
  }

  export interface DividerProps extends ViewProps {
    /**
     * `true` for a vertical line (for use in an `HStack`).
     * @default false
     */
    vertical?: boolean;
  }

  /**
   * A one-pixel separator line.
   *
   * @category AppKit
   */
  export class Divider extends View {
    constructor(props?: DividerProps);
    vertical: boolean;
  }

  export interface SpacerProps extends ViewProps {
    /** Minimum length along the stack's axis. @default 0 */
    minLength?: number;
  }

  /**
   * Empty, stretchable space inside a stack: pushes the views after it to
   * the far edge.
   *
   * @example
   * ```ts
   * const toolbar = new HStack();
   * toolbar.append(new Text({ text: "Title" }), new Spacer(), new Button({ title: "Done" }));
   * ```
   *
   * @category AppKit
   */
  export class Spacer extends View {
    constructor(props?: SpacerProps);
    minLength: number;
  }

  /** A column of a {@link Table}. A bare string is shorthand for `{ title }`. */
  export interface TableColumn {
    /** Identifier; defaults to the title. */
    id?: string;
    /** Header text. */
    title: string;
    /** Width in points; omit or `0` to size automatically. */
    width?: number;
  }

  export interface TableProps extends ViewProps {
    /** @default [] */
    columns?: ReadonlyArray<TableColumn | string>;
    /**
     * Cell text, one inner array per row in column order.
     * @default []
     */
    rows?: ReadonlyArray<ReadonlyArray<string>>;
    /** Selected row indexes. @default [] */
    selectedIndexes?: readonly number[];
    /** Allow selecting more than one row. @default false */
    multiple?: boolean;
    /** @default true */
    headerVisible?: boolean;
    /** Alternate row background colours. @default false */
    alternatingRows?: boolean;
    /** Row height in points. @default the system default (about 24 on current macOS) */
    rowHeight?: number;
    /** Called with the selected row indexes whenever the user changes the selection. */
    onSelect?: (indexes: number[]) => void;
    /** Called with the row index when the user double-clicks a row. */
    onActivate?: (row: number) => void;
  }

  /**
   * A scrolling, multi-column table of text cells.
   *
   * @example
   * ```ts
   * new Table({
   *   columns: ["Name", { title: "Size", width: 80 }],
   *   rows: files.map(f => [f.name, String(f.size)]),
   *   grow: 1,
   *   onActivate(row) {
   *     open(files[row]);
   *   },
   * });
   * ```
   *
   * @category AppKit
   */
  export class Table extends View {
    constructor(props?: TableProps);
    columns: ReadonlyArray<TableColumn | string>;
    rows: ReadonlyArray<ReadonlyArray<string>>;
    /** The selection as the user left it. */
    selectedIndexes: readonly number[];
    multiple: boolean;
    headerVisible: boolean;
    alternatingRows: boolean;
    rowHeight: number;
    onSelect: ((indexes: number[]) => void) | undefined;
    onActivate: ((row: number) => void) | undefined;
  }

  // ---------------------------------------------------------------------
  // Metal

  /**
   * A texture / render-target pixel format (`MTLPixelFormat`).
   *
   * `"bgra8unorm"` is what a {@link MetalView} draws into and the default
   * for {@link Gpu.texture}. Depth formats are only valid for depth
   * attachments.
   */
  export type PixelFormat =
    | "r8unorm"
    | "r16float"
    | "rg8unorm"
    | "r32uint"
    | "r32float"
    | "rg16float"
    | "rgba8unorm"
    | "rgba8unorm-srgb"
    | "bgra8unorm"
    | "bgra8unorm-srgb"
    | "rgb10a2unorm"
    | "rg32float"
    | "rgba16float"
    | "rgba32float"
    | "depth32float"
    | "depth32float-stencil8";

  /**
   * The format of one vertex attribute (`MTLVertexFormat`). `norm` formats
   * are integers read as 0..1 (unsigned) or -1..1 (signed) floats.
   */
  export type VertexFormat =
    | "uchar"
    | "char"
    | "ucharnorm"
    | "charnorm"
    | "uchar4"
    | "char4"
    | "uchar4norm"
    | "char4norm"
    | "uchar4normBgra"
    | "ushort"
    | "short"
    | "ushortnorm"
    | "shortnorm"
    | "ushort2"
    | "ushort4"
    | "short2"
    | "short4"
    | "ushort2norm"
    | "ushort4norm"
    | "short2norm"
    | "short4norm"
    | "half"
    | "half2"
    | "half4"
    | "float"
    | "float2"
    | "float3"
    | "float4"
    | "int"
    | "int2"
    | "int3"
    | "int4"
    | "uint"
    | "uint2"
    | "uint3"
    | "uint4"
    | "int1010102norm"
    | "uint1010102norm";

  /** What kind of primitives a draw call assembles (`MTLPrimitiveType`). */
  export type PrimitiveType = "point" | "line" | "lineStrip" | "triangle" | "triangleStrip";

  /**
   * Where a buffer or texture lives (`MTLStorageMode`).
   *
   * - `"shared"`: one allocation visible to CPU and GPU. The default, and the
   *   only mode whose contents JavaScript can read and write directly.
   * - `"private"`: GPU-only memory; fill it with a blit from a shared buffer.
   * - `"managed"`: separate CPU/GPU copies kept in sync (Intel Macs).
   */
  export type StorageMode = "shared" | "private" | "managed";

  /**
   * How a {@link Gpu.texture texture} may be used (`MTLTextureUsage`).
   *
   * - `"render"`: as a colour or depth attachment of a render pass.
   * - `"read"`: sampled or read in a shader.
   * - `"write"`: written from a compute kernel.
   */
  export type TextureUsage = "render" | "read" | "write";

  /** Depth test comparison (`MTLCompareFunction`). */
  export type CompareFunction =
    | "never"
    | "less"
    | "equal"
    | "lessEqual"
    | "greater"
    | "notEqual"
    | "greaterEqual"
    | "always";

  /** Which triangles to discard by facing (`MTLCullMode`). */
  export type CullMode = "none" | "front" | "back";

  /** Which vertex order counts as front-facing (`MTLWinding`). */
  export type Winding = "cw" | "ccw";

  /** Element type of an index buffer (`MTLIndexType`). */
  export type IndexType = "uint16" | "uint32";

  /** Texture filtering (`MTLSamplerMinMagFilter` / `MTLSamplerMipFilter`). */
  export type FilterMode = "nearest" | "linear";

  /** What sampling outside 0..1 returns (`MTLSamplerAddressMode`). */
  export type AddressMode = "clampToEdge" | "mirrorClampToEdge" | "repeat" | "mirrorRepeat" | "clampToZero";

  /**
   * Colour blending presets for a render pipeline's colour attachments.
   *
   * - `"alpha"`: classic `src.a * src + (1 - src.a) * dst`.
   * - `"premultiplied"`: `src + (1 - src.a) * dst`, for premultiplied colours.
   * - `"add"`: `src + dst`.
   * - `false`: no blending; the fragment replaces the pixel.
   */
  export type BlendMode = "alpha" | "premultiplied" | "add" | false;

  /** A clear colour: a {@link Color} string or `[r, g, b, a]` components from 0 to 1. */
  export type ClearColor = Color | readonly [r: number, g: number, b: number, a: number];

  /** Bytes to upload: any typed array, `DataView` or `ArrayBuffer`. */
  export type BufferSource = ArrayBufferView | ArrayBufferLike;

  /**
   * Thrown by {@link Gpu.library} when Metal Shading Language source does not
   * compile, and by {@link Gpu.renderPipeline} / {@link Gpu.computePipeline}
   * when the functions cannot be linked into a pipeline. `message` is the
   * compiler's log, including `program_source:line:column:` locations.
   */
  export class GpuCompileError extends Error {
    readonly name: "GpuCompileError";
  }

  /**
   * Thrown by {@link GpuFrame.commitAndWait} when the GPU reported an error
   * executing the command buffer (a shader fault, a timeout).
   */
  export class GpuExecutionError extends Error {
    readonly name: "GpuExecutionError";
  }

  export interface GpuBufferOptions {
    /** @default "shared" */
    storage?: StorageMode;
    /** Debug label shown in Xcode's GPU tools. */
    label?: string;
  }

  /**
   * GPU memory (`MTLBuffer`). Create one with {@link Gpu.buffer}.
   *
   * A buffer referenced by an encoded {@link GpuFrame} is kept alive by Metal
   * until that work completes, so letting the JavaScript object be collected
   * mid-frame is safe.
   *
   * @category AppKit
   */
  export class GpuBuffer {
    private constructor();
    readonly byteLength: number;
    readonly storage: StorageMode;
    /** Debug label shown in Xcode's GPU tools; `""` when unset. */
    label: string;
    /**
     * Copy `data` into the buffer at `offset` bytes.
     * @throws RangeError if it does not fit, TypeError for a `"private"` buffer.
     */
    write(data: BufferSource, offset?: number): void;
    /**
     * Copy bytes out of the buffer. Reads what the GPU wrote once the frame
     * that wrote it has completed ({@link GpuFrame.commitAndWait}).
     * @param offset @default 0
     * @param length @default byteLength - offset
     */
    read(offset?: number, length?: number): Uint8Array;
  }

  export interface GpuTextureOptions {
    /** Width in pixels. */
    width: number;
    /** Height in pixels. */
    height: number;
    /** @default "bgra8unorm" */
    format?: PixelFormat;
    /** @default ["render", "read"] */
    usage?: readonly TextureUsage[];
    /** @default "shared" (readable from JavaScript) */
    storage?: StorageMode;
    /** Allocate a full mipmap chain (fill it with {@link GpuFrame.generateMipmaps}). @default false */
    mipmapped?: boolean;
    label?: string;
  }

  /**
   * A 2D texture (`MTLTexture`): a render target, something to sample, or
   * both. Create one with {@link Gpu.texture}.
   *
   * @category AppKit
   */
  export class GpuTexture {
    private constructor();
    readonly width: number;
    readonly height: number;
    readonly format: PixelFormat;
    label: string;
    /**
     * Upload pixel data for the whole texture (mip level 0).
     * @param bytesPerRow @default width × bytes per pixel
     */
    replace(data: BufferSource, bytesPerRow?: number): void;
    /**
     * Copy the texture's pixels back to JavaScript as tightly packed rows
     * (`width * height * bytesPerPixel` bytes, in the texture's own format, so
     * a `"bgra8unorm"` texture yields B, G, R, A bytes). GPU writes are visible
     * once the frame that made them has completed.
     * @throws TypeError for a `"private"` texture.
     */
    readPixels(): Uint8Array;
  }

  /**
   * One shader function from a {@link GpuLibrary}: a `vertex`, `fragment` or
   * `kernel` function.
   *
   * @category AppKit
   */
  export class GpuFunction {
    private constructor();
    readonly name: string;
  }

  /**
   * Compiled Metal Shading Language source (`MTLLibrary`). Create one with
   * {@link Gpu.library}.
   *
   * @category AppKit
   */
  export class GpuLibrary {
    private constructor();
    /** Names of every function in the library. */
    readonly functionNames: readonly string[];
    label: string;
    /**
     * Look up a function by name.
     * @throws TypeError whose message lists the available names when there is no such function.
     */
    function(name: string): GpuFunction;
  }

  /** One attribute the vertex function reads from a vertex buffer via `[[stage_in]]`. */
  export interface VertexAttribute {
    format: VertexFormat;
    /** Byte offset of the attribute inside one vertex. */
    offset: number;
    /**
     * Which vertex buffer (the `index` given to {@link GpuFrame.vertexBuffer}) it comes from.
     * @default 0
     */
    buffer?: number;
  }

  /**
   * How vertices are laid out in a vertex buffer, for pipelines whose vertex
   * function takes a `[[stage_in]]` argument. Attribute `i` in `attributes`
   * is `[[attribute(i)]]` in the shader. Pipelines that index buffers by
   * `[[vertex_id]]` themselves do not need one.
   */
  export interface VertexLayout {
    /** Bytes from one vertex to the next. */
    stride: number;
    /**
     * `"vertex"` advances per vertex, `"instance"` per instance.
     * @default "vertex"
     */
    step?: "vertex" | "instance";
    attributes: readonly VertexAttribute[];
  }

  export interface GpuRenderPipelineOptions {
    /** A `vertex` function. */
    vertex: GpuFunction;
    /** A `fragment` function; omit for depth-only rendering. */
    fragment?: GpuFunction;
    /**
     * Pixel format of each colour attachment the pipeline renders to; must
     * match the textures (or view) used in the render pass.
     * @default ["bgra8unorm"]
     */
    colorFormats?: readonly PixelFormat[];
    /** Blending for every colour attachment. @default false */
    blend?: BlendMode;
    /** Set when the render pass has a depth attachment. @default undefined */
    depthFormat?: PixelFormat;
    /** Vertex buffer layout for a `[[stage_in]]` vertex function. */
    vertexLayout?: VertexLayout;
    /** MSAA sample count; must match the render target. @default 1 */
    sampleCount?: number;
    label?: string;
  }

  /**
   * A compiled vertex + fragment pipeline (`MTLRenderPipelineState`). Create
   * one with {@link Gpu.renderPipeline}; creating pipelines is expensive, so
   * do it once, not per frame.
   *
   * @category AppKit
   */
  export class GpuRenderPipeline {
    private constructor();
    readonly colorFormats: readonly PixelFormat[];
    readonly depthFormat: PixelFormat | null;
    readonly label: string;
  }

  /**
   * A compiled compute pipeline (`MTLComputePipelineState`) around one
   * `kernel` function. Create one with {@link Gpu.computePipeline}.
   *
   * @category AppKit
   */
  export class GpuComputePipeline {
    private constructor();
    /** The most threads one threadgroup of this kernel may have on this device. */
    readonly maxTotalThreadsPerThreadgroup: number;
    /** The SIMD width the kernel executes at; a good threadgroup width. */
    readonly threadExecutionWidth: number;
    readonly label: string;
  }

  export interface GpuSamplerOptions {
    /** Shorthand that sets both `minFilter` and `magFilter`. */
    filter?: FilterMode;
    /** @default "nearest" */
    minFilter?: FilterMode;
    /** @default "nearest" */
    magFilter?: FilterMode;
    /** Filtering between mip levels; `"none"` always samples level 0. @default "none" */
    mipFilter?: FilterMode | "none";
    /** Shorthand that sets both `addressU` and `addressV`. */
    address?: AddressMode;
    /** @default "clampToEdge" */
    addressU?: AddressMode;
    /** @default "clampToEdge" */
    addressV?: AddressMode;
    /** Anisotropic filtering, 1 (off) to 16. @default 1 */
    maxAnisotropy?: number;
    /** Makes this a comparison sampler for shadow maps (`sample_compare` in MSL). */
    compare?: CompareFunction;
    label?: string;
  }

  /**
   * Texture sampling state (`MTLSamplerState`) bound with
   * {@link GpuFrame.fragmentSampler}. Create one with {@link Gpu.sampler}.
   *
   * @category AppKit
   */
  export class GpuSampler {
    private constructor();
    readonly label: string;
  }

  export interface GpuDepthStencilOptions {
    /** A fragment passes when `compare(fragmentDepth, storedDepth)` holds. @default "less" */
    compare?: CompareFunction;
    /** Write passing fragments' depth to the depth attachment. @default true */
    write?: boolean;
    label?: string;
  }

  /**
   * Depth test state (`MTLDepthStencilState`) bound with
   * {@link GpuFrame.depthStencil}. Create one with {@link Gpu.depthStencil}.
   *
   * @category AppKit
   */
  export class GpuDepthStencil {
    private constructor();
    readonly label: string;
  }

  /** An offscreen render target for {@link GpuFrame.renderPass}. */
  export interface RenderPassTarget {
    /** The colour attachment (`[[color(0)]]` in the fragment function): a texture created with `"render"` usage. */
    color: GpuTexture;
    /**
     * Clear the colour attachment to this colour first, or `false` to keep
     * its current contents.
     * @default [0, 0, 0, 1]
     */
    clear?: ClearColor | false;
    /** A `"depth32float"` texture, the same size as `color`, to use as the depth attachment. */
    depth?: GpuTexture;
    /** Value the depth attachment is cleared to first, or `false` to keep its contents. @default 1 */
    clearDepth?: number | false;
  }

  export interface DrawOptions {
    /** First vertex. @default 0 */
    start?: number;
    /** Instance count (`[[instance_id]]` in the vertex function). @default 1 */
    instances?: number;
    /** @default "triangle" */
    primitive?: PrimitiveType;
  }

  export interface DrawIndexedOptions {
    /** @default "uint16" */
    indexType?: IndexType;
    /** Byte offset of the first index in `indexBuffer`. @default 0 */
    offset?: number;
    /** @default 1 */
    instances?: number;
    /** @default "triangle" */
    primitive?: PrimitiveType;
  }

  export interface CopyBufferOptions {
    /** @default 0 */
    srcOffset?: number;
    /** @default 0 */
    dstOffset?: number;
    /** Bytes to copy. @default the rest of `src` from `srcOffset` */
    size?: number;
  }

  /** Passed to {@link MetalView.onFrame} with each frame. */
  export interface FrameInfo {
    /** Seconds since this view's first frame. */
    time: number;
    /** Seconds since the previous frame (`0` on the first). */
    dt: number;
    /** Drawable width in pixels. */
    width: number;
    /** Drawable height in pixels. */
    height: number;
  }

  /**
   * One command buffer's worth of GPU work (`MTLCommandBuffer`), encoded by
   * chaining methods and then submitted with {@link GpuFrame.commit} or
   * {@link GpuFrame.commitAndWait}. {@link MetalView.onFrame} hands you one
   * per frame; {@link Gpu.frame} makes one for offscreen work.
   *
   * There is one current encoder at a time: `renderPass()`, `computePass()`
   * and `blit()` each end the previous one and start a new one, and the
   * binding/draw/dispatch/copy methods apply to whichever is current. All
   * encoding happens on the main thread; the GPU runs the work asynchronously
   * after `commit()`.
   *
   * After `commit()`/`commitAndWait()` the frame is spent and every method
   * throws.
   *
   * @example
   * ```ts
   * gpu.frame()
   *   .renderPass({ color: target, clear: "#000" })
   *   .pipeline(trianglePipeline)
   *   .vertexBuffer(0, vertices)
   *   .draw(3)
   *   .end()
   *   .commitAndWait();
   * const pixels = target.readPixels();
   * ```
   *
   * @category AppKit
   */
  export class GpuFrame {
    private constructor();
    /** Whether `commit()` or `commitAndWait()` has been called. */
    readonly committed: boolean;
    /** Which kind of pass, if any, the encoder methods currently apply to. */
    readonly state: "open" | "in a render pass" | "in a compute pass" | "in a blit pass" | "committed";
    label: string;

    /**
     * Start a render pass into a {@link MetalView}'s current drawable (it is
     * presented on commit) or into offscreen texture(s).
     * @throws if the view has no drawable (no GPU, or the view has no size yet).
     */
    renderPass(target: MetalView | RenderPassTarget): this;
    /** Start a compute pass. */
    computePass(): this;
    /** Start a blit (copy) pass. */
    blit(): this;
    /** End the current pass. Optional: starting another pass or committing ends it too. */
    end(): this;

    /**
     * Set the pipeline for the current render or compute pass.
     * @throws GpuCompileError if a render pipeline's formats or sample count do not match the pass.
     */
    pipeline(pipeline: GpuRenderPipeline | GpuComputePipeline): this;
    /** Open a named group in Xcode's GPU capture for the commands that follow (render and compute passes). */
    pushDebugGroup(name: string): this;
    popDebugGroup(): this;

    // Render pass bindings: `[[buffer(index)]]`, `[[texture(index)]]`, `[[sampler(index)]]`.
    vertexBuffer(index: number, buffer: GpuBuffer, offset?: number): this;
    /** Bind up to 4 KB of data copied from `data` (uniforms) without a `GpuBuffer`. */
    vertexBytes(index: number, data: BufferSource): this;
    vertexTexture(index: number, texture: GpuTexture): this;
    fragmentBuffer(index: number, buffer: GpuBuffer, offset?: number): this;
    /** Bind up to 4 KB of data copied from `data` without a `GpuBuffer`. */
    fragmentBytes(index: number, data: BufferSource): this;
    fragmentTexture(index: number, texture: GpuTexture): this;
    fragmentSampler(index: number, sampler: GpuSampler): this;
    /** Viewport in pixels. @param near @default 0 @param far @default 1 */
    viewport(x: number, y: number, width: number, height: number, near?: number, far?: number): this;
    /** Scissor rectangle in pixels. */
    scissor(x: number, y: number, width: number, height: number): this;
    /** @default "none" */
    cull(mode: CullMode): this;
    /** @default "cw" */
    winding(winding: Winding): this;
    depthStencil(state: GpuDepthStencil): this;
    /**
     * Draw `vertexCount` vertices with the current pipeline and bindings.
     * @throws TypeError if no render pipeline is set.
     */
    draw(vertexCount: number, options?: DrawOptions): this;
    /** Draw `indexCount` indices taken from `indexBuffer`. */
    drawIndexed(indexCount: number, indexBuffer: GpuBuffer, options?: DrawIndexedOptions): this;

    // Compute pass bindings.
    buffer(index: number, buffer: GpuBuffer, offset?: number): this;
    /** Bind up to 4 KB of data copied from `data` without a `GpuBuffer`. */
    bytes(index: number, data: BufferSource): this;
    texture(index: number, texture: GpuTexture): this;
    sampler(index: number, sampler: GpuSampler): this;
    /**
     * Run the current compute pipeline over a 1-, 2- or 3-dimensional grid of
     * `threads` (`[[thread_position_in_grid]]`); Metal handles a grid that is
     * not a multiple of the threadgroup size.
     * @param threads total grid size, e.g. `1024` or `[width, height]`.
     * @param threadsPerGroup threadgroup size. @default as many of the pipeline's threads as fit, along the grid's axes
     */
    dispatch(
      threads: number | readonly [x: number, y?: number, z?: number],
      threadsPerGroup?: number | readonly [x: number, y?: number, z?: number],
    ): this;
    /** Run `groups` whole threadgroups of `threadsPerGroup` threads each (`[[threadgroup_position_in_grid]]`). */
    dispatchGroups(
      groups: number | readonly [x: number, y?: number, z?: number],
      threadsPerGroup: number | readonly [x: number, y?: number, z?: number],
    ): this;

    // Blit pass.
    /** Copy bytes between buffers on the GPU (the way to fill a `"private"` buffer). */
    copyBuffer(src: GpuBuffer, dst: GpuBuffer, options?: CopyBufferOptions): this;
    /** Fill a `mipmapped` texture's smaller levels from level 0. */
    generateMipmaps(texture: GpuTexture): this;

    /**
     * Submit the work and return immediately. A pass into a {@link MetalView}
     * is presented when the GPU finishes.
     */
    commit(): void;
    /**
     * Submit the work and block until the GPU has finished it, so buffer and
     * texture reads see the results. Meant for readbacks and tests; prefer
     * `commit()` in a frame loop.
     * @throws GpuExecutionError if the GPU failed to run the work.
     */
    commitAndWait(): void;
  }

  /**
   * MSL types {@link Gpu.struct} understands, with their Metal sizes and
   * alignments (a `float3` occupies 16 bytes).
   */
  export type MslScalarType =
    | "bool"
    | "uchar4"
    | "short"
    | "ushort"
    | "half"
    | "half2"
    | "half3"
    | "half4"
    | "int"
    | "int2"
    | "int3"
    | "int4"
    | "uint"
    | "uint2"
    | "uint3"
    | "uint4"
    | "float"
    | "float2"
    | "float3"
    | "float4"
    | "float2x2"
    | "float3x3"
    | "float4x4";

  /** The JavaScript value {@link StructLayout.pack} accepts for a field of MSL type `T`. */
  export type MslValue<T extends MslScalarType> = T extends "bool"
    ? boolean
    : T extends "float" | "int" | "uint" | "short" | "ushort" | "half"
      ? number
      : ArrayLike<number>;

  /** Layout of one field of a {@link StructLayout}. */
  export interface StructField {
    readonly name: string;
    readonly type: MslScalarType;
    /** Byte offset inside the struct. */
    readonly offset: number;
    /** Bytes the field occupies (16 for `float3`). */
    readonly size: number;
    readonly align: number;
  }

  /**
   * The memory layout of an MSL `struct`, computed with Metal's size and
   * alignment rules so that data packed from JavaScript lines up with what a
   * shader reads. Create one with {@link Gpu.struct}.
   *
   * @example
   * ```ts
   * const Uniforms = gpu.struct({ mvp: "float4x4", tint: "float3", time: "float" });
   * Uniforms.size;            // 96
   * Uniforms.fields.tint;     // { offset: 64, size: 16, ... }
   * Uniforms.msl;             // "struct Uniforms {\n  float4x4 mvp;\n  float3 tint;\n  float time;\n};"
   * frame.vertexBytes(1, Uniforms.pack({ mvp: matrix, tint: [1, 0.5, 0], time }));
   * ```
   */
  export interface StructLayout<T extends Record<string, MslScalarType> = Record<string, MslScalarType>> {
    /** The struct's name in {@link StructLayout.msl}. */
    readonly name: string;
    /** Total size in bytes, padded to {@link StructLayout.align}. */
    readonly size: number;
    /** The struct's alignment: the largest field alignment. */
    readonly align: number;
    readonly fields: { readonly [K in keyof T]: StructField };
    /** An MSL declaration of the struct to paste into shader source. */
    readonly msl: string;
    /**
     * Write field values into a new `ArrayBuffer` of {@link StructLayout.size}
     * bytes. Fields missing from `values` are left zero. Vectors and matrices
     * take arrays or typed arrays (matrices column-major; a 3-row column may be
     * given as 3 or 4 numbers).
     * @throws TypeError naming the field when a value has the wrong shape.
     */
    pack(values: { readonly [K in keyof T]?: MslValue<T[K]> }): ArrayBuffer;
    /** Write into `target` at `byteOffset` instead, and return `target`. */
    pack<B extends ArrayBufferView | ArrayBufferLike>(
      values: { readonly [K in keyof T]?: MslValue<T[K]> },
      target: B,
      byteOffset?: number,
    ): B;
  }

  /**
   * The Metal device and factory for GPU objects. Everything is created on
   * the system default device with one command queue.
   */
  export interface Gpu {
    /**
     * Whether this Mac has a Metal device. `false` inside virtual machines
     * and some sandboxes; every other member then throws
     * `TypeError: Metal is not available`, and a {@link MetalView} lays out but
     * never calls `onFrame`.
     */
    readonly available: boolean;
    /** The device name, e.g. `"Apple M3"`, or `null` without a GPU. */
    readonly name: string | null;
    /** Whether CPU and GPU share memory (Apple silicon). */
    readonly unifiedMemory: boolean;
    /**
     * Allocate GPU memory, either zero-filled of `byteLength` bytes or
     * initialised with a copy of `data`.
     *
     * @example
     * ```ts
     * const vertices = gpu.buffer(new Float32Array([0, 1, -1, -1, 1, -1]));
     * const scratch = gpu.buffer(4096, { storage: "private" });
     * ```
     */
    buffer(byteLength: number, options?: GpuBufferOptions): GpuBuffer;
    buffer(data: BufferSource, options?: GpuBufferOptions): GpuBuffer;
    /** Create a 2D texture. */
    texture(options: GpuTextureOptions): GpuTexture;
    /**
     * Compile Metal Shading Language source.
     * @throws GpuCompileError with the compiler log on a syntax or type error.
     *
     * @example
     * ```ts
     * const lib = gpu.library(`
     *   #include <metal_stdlib>
     *   using namespace metal;
     *   kernel void twice(device float* v [[buffer(0)]], uint i [[thread_position_in_grid]]) { v[i] *= 2; }
     * `);
     * const twice = gpu.computePipeline(lib.function("twice"));
     * ```
     */
    library(source: string, options?: { label?: string }): GpuLibrary;
    /**
     * Build a render pipeline from a vertex and a fragment function.
     * @throws GpuCompileError if the functions cannot be linked.
     */
    renderPipeline(options: GpuRenderPipelineOptions): GpuRenderPipeline;
    /** Build a compute pipeline from a `kernel` function. */
    computePipeline(fn: GpuFunction, options?: { label?: string }): GpuComputePipeline;
    sampler(options?: GpuSamplerOptions): GpuSampler;
    depthStencil(options?: GpuDepthStencilOptions): GpuDepthStencil;
    /** A new command buffer for offscreen work (rendering to textures, compute, copies). */
    frame(options?: { label?: string }): GpuFrame;
    /**
     * Describe an MSL struct so JavaScript can pack data for it. Pure layout
     * arithmetic: works without a GPU.
     * @param name the struct's name in the generated {@link StructLayout.msl}. @default "Uniforms"
     */
    struct<const T extends Record<string, MslScalarType>>(fields: T, name?: string): StructLayout<T>;
  }

  /**
   * The GPU. See {@link Gpu}.
   *
   * @example
   * ```ts
   * import { gpu } from "bun:appkit";
   * if (!gpu.available) throw new Error("needs a Mac with Metal");
   * console.log(gpu.name);
   * ```
   */
  export const gpu: Gpu;

  export interface MetalViewProps extends ViewProps {
    /**
     * Colour the drawable is cleared to at the start of a
     * {@link GpuFrame.renderPass renderPass(view)}.
     * @default "#000000"
     */
    clearColor?: Color;
    /**
     * Target frame rate while the view is on screen and {@link MetalViewProps.running running}.
     * @default 60
     */
    preferredFPS?: number;
    /**
     * Drive `onFrame` from the display's refresh timer. With `false` (or with
     * no display attached) frames only happen when you call {@link MetalView.draw}.
     * @default true
     */
    running?: boolean;
    /** See {@link MetalView.onFrame}. */
    onFrame?: (frame: GpuFrame, info: FrameInfo) => void;
    /** See {@link MetalView.onResize}. */
    onResize?: (size: Size) => void;
  }

  /**
   * A view you draw into with Metal (`MTKView`). Each frame it hands
   * {@link MetalView.onFrame} a {@link GpuFrame}; encode a render pass into
   * the view with `frame.renderPass(view)` and the result is presented when
   * the frame commits (automatically after `onFrame` returns, unless you
   * committed it yourself). It sizes like any other view: give it
   * `width`/`height` or `grow`.
   *
   * Without a GPU ({@link Gpu.available} `false`) the view still takes part
   * in layout but never produces frames.
   *
   * @example
   * ```ts
   * const view = new MetalView({
   *   grow: 1,
   *   clearColor: "#202020",
   *   onFrame(frame, { time }) {
   *     frame.renderPass(view).pipeline(pipeline).vertexBytes(0, Float32Array.of(time)).draw(3);
   *   },
   * });
   * ```
   *
   * @category AppKit
   */
  export class MetalView extends View {
    constructor(props?: MetalViewProps);
    clearColor: Color;
    preferredFPS: number;
    running: boolean;
    /** Size of the drawable in pixels (the view's size times the screen's scale). */
    readonly drawableSize: Size;
    /** The same object as the module's {@link gpu} export. */
    readonly gpu: Gpu;
    /**
     * Called once per frame with a fresh {@link GpuFrame}. If the handler
     * returns without committing the frame it is committed for you; if it
     * throws, the frame is dropped and the error is reported.
     */
    onFrame: ((frame: GpuFrame, info: FrameInfo) => void) | undefined;
    /** Called with the new drawable size in pixels when the view resizes or changes screen. */
    onResize: ((size: Size) => void) | undefined;
    /**
     * Render one frame now, synchronously running `onFrame`. This is how a
     * paused view, a headless process or a test produces frames.
     */
    draw(): void;
  }
}

/**
 * A React renderer for `bun:appkit`: write native macOS windows as JSX using
 * the `react` and `react-reconciler` packages installed in your project
 * (`bun add react react-reconciler`).
 *
 * Host components are exported as constants, so a `react-dom` app ports by
 * swapping HTML tags for these. Props are the same as the options of the
 * matching `bun:appkit` class; changed props are assigned to the live view.
 * String children of `Text`, `Button`, `Checkbox`, `Radio` and `Group` become
 * their `text`/`title`.
 *
 * @example
 * ```tsx
 * import { useState } from "react";
 * import { render, Window, VStack, Text, Button } from "bun:appkit/react";
 *
 * function Counter() {
 *   const [count, setCount] = useState(0);
 *   return (
 *     <Window title="Counter" width={300} height={120}>
 *       <VStack padding={20} spacing={12}>
 *         <Text font={{ size: 24, weight: "bold" }}>Count: {count}</Text>
 *         <Button onClick={() => setCount(c => c + 1)}>Increment</Button>
 *       </VStack>
 *     </Window>
 *   );
 * }
 *
 * render(<Counter />);
 * ```
 *
 * @module bun:appkit/react
 */
declare module "bun:appkit/react" {
  import type * as AppKit from "bun:appkit";

  /**
   * A host component. `ref` receives the underlying `bun:appkit` instance
   * (a {@link AppKit.Window} or {@link AppKit.View} subclass).
   */
  export type AppKitComponent<P> = (props: P & { children?: any; key?: string | number | null; ref?: any }) => any;

  /** Props of {@link Window}: {@link AppKit.WindowOptions} with the content given as the single child. */
  export interface WindowProps extends Omit<AppKit.WindowOptions, "content"> {}
  export interface VStackProps extends AppKit.VStackProps {}
  export interface HStackProps extends AppKit.HStackProps {}
  export interface ZStackProps extends AppKit.ZStackProps {}
  export interface GroupProps extends AppKit.GroupProps {}
  export interface ScrollViewProps extends AppKit.ScrollViewProps {}
  export interface SplitViewProps extends AppKit.SplitViewProps {}
  export interface TextProps extends AppKit.TextProps {}
  export interface ButtonProps extends AppKit.ButtonProps {}
  export interface CheckboxProps extends AppKit.CheckboxProps {}
  export interface RadioProps extends AppKit.RadioProps {}
  export interface SwitchProps extends AppKit.SwitchProps {}
  export interface TextFieldProps extends AppKit.TextFieldProps {}
  export interface SecureFieldProps extends AppKit.SecureFieldProps {}
  export interface SearchFieldProps extends AppKit.SearchFieldProps {}
  export interface TextEditorProps extends AppKit.TextEditorProps {}
  export interface SliderProps extends AppKit.SliderProps {}
  export interface PickerProps extends AppKit.PickerProps {}
  export interface SegmentedProps extends AppKit.SegmentedProps {}
  export interface ProgressProps extends AppKit.ProgressProps {}
  export interface ImageProps extends AppKit.ImageProps {}
  export interface DividerProps extends AppKit.DividerProps {}
  export interface SpacerProps extends AppKit.SpacerProps {}
  export interface TableProps extends AppKit.TableProps {}
  export interface MetalViewProps extends AppKit.MetalViewProps {}

  /** A window; shown when mounted and closed when unmounted. Its child is the root view. */
  export const Window: AppKitComponent<WindowProps>;
  export const VStack: AppKitComponent<VStackProps>;
  export const HStack: AppKitComponent<HStackProps>;
  export const ZStack: AppKitComponent<ZStackProps>;
  export const Group: AppKitComponent<GroupProps>;
  export const ScrollView: AppKitComponent<ScrollViewProps>;
  export const SplitView: AppKitComponent<SplitViewProps>;
  /** A label. String and number children become its `text`. */
  export const Text: AppKitComponent<TextProps>;
  /** A push button. String children become its `title`. */
  export const Button: AppKitComponent<ButtonProps>;
  export const Checkbox: AppKitComponent<CheckboxProps>;
  export const Radio: AppKitComponent<RadioProps>;
  export const Switch: AppKitComponent<SwitchProps>;
  export const TextField: AppKitComponent<TextFieldProps>;
  export const SecureField: AppKitComponent<SecureFieldProps>;
  export const SearchField: AppKitComponent<SearchFieldProps>;
  export const TextEditor: AppKitComponent<TextEditorProps>;
  export const Slider: AppKitComponent<SliderProps>;
  export const Picker: AppKitComponent<PickerProps>;
  export const Segmented: AppKitComponent<SegmentedProps>;
  export const Progress: AppKitComponent<ProgressProps>;
  export const Image: AppKitComponent<ImageProps>;
  export const Divider: AppKitComponent<DividerProps>;
  export const Spacer: AppKitComponent<SpacerProps>;
  export const Table: AppKitComponent<TableProps>;
  /** A Metal-backed view; see {@link AppKit.MetalView}. `onFrame` is an ordinary prop. */
  export const MetalView: AppKitComponent<MetalViewProps>;

  /** A mounted React tree. */
  export interface Root {
    /** Render (or re-render) `element` into this root. */
    render(element: unknown): void;
    /** Unmount everything, closing the windows the tree created. */
    unmount(): void;
  }

  /**
   * Create an empty root to render into later.
   *
   * @example
   * ```tsx
   * const root = createRoot();
   * root.render(<App />);
   * // later
   * root.unmount();
   * ```
   */
  export function createRoot(): Root;

  /**
   * Mount `element` synchronously: windows in the tree exist by the time
   * `render` returns.
   *
   * @throws if `react` and `react-reconciler` cannot be resolved from the
   * application's directory.
   */
  export function render(element: unknown): Root;

  /**
   * Run `fn` and flush the state updates it schedules before returning, like
   * `react-dom`'s `flushSync`.
   */
  export function flushSync<R>(fn: () => R): R;
  export function flushSync(): void;
}
