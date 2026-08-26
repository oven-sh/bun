/**
 * Native macOS windows and controls from JavaScript.
 *
 * `bun:appkit` creates real AppKit windows, stacks, buttons, text fields,
 * tables and menus without a web view. AppKit is loaded on first use, so
 * programs that never touch it pay nothing.
 *
 * It is a curated layer written in JavaScript on `bun:objc`, the
 * Objective-C bridge: {@link Window}, {@link VStack}, {@link Button},
 * {@link Table}, the menu bar and the other classes here each have
 * {@link View.native `.native`} (the `NSWindow` or `NSView` they made),
 * props that read the object live, and enumeration props that take every
 * member by Apple's name; anything they do not cover is an
 * `objc.classes.X` away (`import { objc } from "bun:objc"`). Native code only
 * loads the frameworks, runs Bun's event loop inside AppKit's, owns the
 * application lifecycle, and provides {@link MetalView} and {@link gpu}.
 *
 * The app, windows, views, menus, {@link MetalView} and {@link gpu} run on
 * the process's main JavaScript thread, as AppKit requires (`bun:objc`
 * also works in a `Worker` for everything that is not AppKit UI). While
 * windows are open Bun's event loop keeps running as
 * usual: timers, `fetch`, sockets, workers and subprocesses all continue to
 * work. The process exits when the last window closes and nothing else keeps
 * the event loop alive (set {@link App.keepAlive `app.keepAlive`} to stay
 * running with no windows).
 *
 * While AppKit runs a tracking loop (an open menu, a window being live-resized)
 * timers and I/O pause and resume when the gesture ends; a long synchronous
 * callback stalls the UI like it would any other.
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
 * `bun:appkit` exists only on macOS; elsewhere it is not a builtin and
 * `process.getBuiltinModule("bun:appkit")` returns `undefined`.
 *
 * The types of each `.native` (`objc.NSWindow`, `objc.NSButton`) have their
 * methods declared once a file says
 * `/// <reference types="bun-types/objc-sdk" />`; see `bun:objc`.
 *
 * @module bun:appkit
 * @platform macOS
 * @experimental
 */
declare module "bun:appkit" {
  import type { ActivationPolicy, ObjC, objc, ObjCObject, QuitEvent } from "bun:objc";
  export type { ActivationPolicy, QuitEvent };

  global {
    namespace NodeJS {
      interface Process {
        /** The module on macOS; `undefined` elsewhere, where it is not a builtin. */
        getBuiltinModule(id: "bun:appkit"): typeof import("bun:appkit") | undefined;
      }
    }
  }

  /**
   * A dynamic system colour name. These follow the user's appearance
   * (light/dark mode, accent colour, increased contrast) wherever AppKit
   * draws them (`Text.color`, control tints). Layer colours (a view's
   * `background` and `border`) are resolved once, when set, and keep that
   * value across a later appearance change.
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
   * A colour: a string, or an `NSColor` handle from the bridge.
   *
   * - `"#rgb"`, `"#rgba"`, `"#rrggbb"`, `"#rrggbbaa"` (sRGB)
   * - `"rgb(255, 128, 0)"`, `"rgba(255, 128, 0, 0.5)"` (channels 0–255 or percentages, alpha 0–1)
   * - a {@link SystemColor} name such as `"label"`, `"accent"`, `"red"` or `"windowBackground"`
   * - any of `NSColor`'s class colours by Apple's name: `"systemRedColor"`,
   *   `"labelColor"`, `"controlAccentColor"`, `"findHighlightColor"`, …
   * - an `NSColor` you made or read off a control
   *   (`objc.classes.NSColor.colorWithCalibratedHue_saturation_brightness_alpha_(…)`)
   *
   * A colour prop AppKit itself holds (`Text.color`, `tint`, a window's
   * `background`) reads live: the value you gave while that is still the
   * control's colour, otherwise the `NSColor` handle the control has now.
   *
   * @example
   * ```ts
   * text.color = "secondaryLabel";
   * text.color = "systemIndigoColor";
   * box.background = "#1e1e1eff";
   * box.border = { width: 1, color: "rgba(0, 0, 0, 0.2)" };
   * label.color = objc.classes.NSColor.colorWithSRGBRed_green_blue_alpha_(0.2, 0.4, 1, 1);
   * ```
   */
  export type Color =
    | SystemColor
    | `#${string}`
    | `rgb(${string})`
    | `rgba(${string})`
    | `${string}Color`
    | ObjCObject
    | (string & {});

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
   * A font: just a point size, a {@link FontSpec}, or an `NSFont` handle
   * from the bridge. A `font` prop reads live like a {@link Color}: what
   * you gave while the control still has that font, else its `NSFont`.
   *
   * @example
   * ```ts
   * new Text({ text: "Title", font: { size: 20, weight: "semibold" } });
   * new Text({ text: "0x1f", font: { design: "monospaced" } });
   * new Text({ text: "small", font: 11 });
   * new Text({ text: "custom", font: objc.classes.NSFont.fontWithName_size_("Menlo", 12) });
   * ```
   */
  export type Font = number | FontSpec | ObjCObject;

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
   * How a {@link VStack}/{@link HStack} places children on the cross axis
   * (`-[NSStackView alignment]`, an `NSLayoutAttribute` on that axis).
   *
   * - `"fill"` stretches each child across the stack (leading or centre
   *   alignment plus a width or height constraint per child).
   * - `"leading"`/`"trailing"` apply to a `VStack`; `"top"`/`"bottom"`/
   *   `"firstBaseline"`/`"lastBaseline"` apply to an `HStack`; `"center"` to both.
   *   A name for the other axis maps across (`"bottom"` on a `VStack` is
   *   `"trailing"`). Assigning also takes any {@link NSLayoutAttributeName}
   *   or its number; reading gives the name above for the stack's axis when
   *   there is one, else `NSLayoutAttribute`'s.
   */
  export type Align = "fill" | "leading" | "center" | "trailing" | "top" | "bottom" | "firstBaseline" | "lastBaseline";

  /** `NSLayoutAttribute` by Apple's member names, prefix dropped; see {@link Align}. */
  export type NSLayoutAttributeName =
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "leading"
    | "trailing"
    | "width"
    | "height"
    | "centerX"
    | "centerY"
    | "lastBaseline"
    | "baseline"
    | "firstBaseline"
    | "notAnAttribute";

  /**
   * How a stack distributes children along its own axis
   * (`NSStackViewDistribution`).
   *
   * - `"fill"`: children keep their natural size and those with
   *   {@link View.grow `grow`} share the leftover length in proportion to it.
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

  /** `NSStackViewDistribution` by Apple's member names, prefix dropped; see {@link Distribution} (`"gravityAreas"` is `"gravity"` there). */
  export type NSStackViewDistributionName =
    | "gravityAreas"
    | "fill"
    | "fillEqually"
    | "fillProportionally"
    | "equalSpacing"
    | "equalCentering";

  /**
   * Horizontal alignment of text inside a {@link Text} or text field:
   * `NSTextAlignment` by Apple's member names with the prefix dropped.
   * Assigning also takes the full name (`"NSTextAlignmentCenter"`) or the
   * member's number (`objc.enums.NSTextAlignment.center`).
   */
  export type TextAlign = "left" | "center" | "right" | "justified" | "natural";

  /**
   * `NSBezelStyle`, by Apple's member names with the prefix dropped:
   * `"push"` is `NSBezelStylePush`. The names after `"glass"` are the
   * deprecated aliases AppKit still declares; reading `bezelStyle` gives the
   * current name for a value. Assigning also takes the member's number
   * (`objc.enums.NSBezelStyle.push`), and a value this list has no name for
   * reads back as its number.
   */
  export type BezelStyle =
    | "automatic"
    | "push"
    | "flexiblePush"
    | "disclosure"
    | "circular"
    | "helpButton"
    | "smallSquare"
    | "toolbar"
    | "accessoryBarAction"
    | "accessoryBar"
    | "pushDisclosure"
    | "badge"
    | "glass"
    | "shadowlessSquare"
    | "texturedSquare"
    | "rounded"
    | "regularSquare"
    | "texturedRounded"
    | "roundRect"
    | "recessed"
    | "roundedDisclosure"
    | "inline";

  /**
   * How an {@link Image} scales its picture to the view's bounds
   * (`-imageScaling`).
   *
   * - `"down"`: shrink proportionally to fit, never enlarge (`NSImageScaleProportionallyDown`).
   * - `"fit"`: scale proportionally up or down to fit (`NSImageScaleProportionallyUpOrDown`).
   * - `"fill"`: stretch each axis independently (`NSImageScaleAxesIndependently`).
   * - `"none"`: draw at natural size (`NSImageScaleNone`).
   *
   * Assigning also takes `NSImageScaling`'s own member names (short or
   * full) or the number; reading gives the name above.
   */
  export type ImageScaling = "down" | "fit" | "fill" | "none";

  /** `NSImageScaling` by Apple's member names, prefix dropped; see {@link ImageScaling}. */
  export type NSImageScalingName =
    | "scaleProportionallyDown"
    | "scaleAxesIndependently"
    | "scaleNone"
    | "scaleProportionallyUpOrDown";

  /**
   * What an {@link Image} shows.
   *
   * - `{ symbol }`: an SF Symbol by name, e.g. `"star.fill"`.
   * - `{ file }`: an image file on disk (PNG, JPEG, HEIC, PDF, …).
   * - `{ data }`: encoded image bytes.
   * - an `NSImage` handle from the bridge.
   */
  export type ImageSource = { symbol: string } | { file: string } | { data: Uint8Array | ArrayBuffer } | ObjCObject;

  /** A line between menu items. */
  export type MenuSeparator = "separator" | "-";

  /**
   * One item in a menu. The object is read when {@link App.menu} is
   * assigned; changing its fields afterwards does nothing until the array
   * is assigned again, but {@link App.menuItem} gives the `NSMenuItem` built
   * from it for changes in place.
   *
   * @example
   * ```ts
   * const save: MenuItem = { title: "Save", key: "s", onClick: () => save() };
   * const copy: MenuItem = { title: "Copy", key: "c", action: "copy:" };
   * ```
   */
  export interface MenuItem {
    /** The text shown for the item (`-[NSMenuItem title]`). */
    title: string;
    /**
     * Called when the item is chosen: the item's target is a script object
     * and this is its action. The app also emits a `"menu"` event with this
     * item.
     */
    onClick?: () => void;
    /**
     * What choosing the item does, instead of `onClick`: a function (the
     * same as `onClick`), or the name of an Objective-C action method such
     * as `"copy:"`, `"performClose:"` or `"toggleFullScreen:"` (one
     * argument, the sender, so one trailing colon). A selector is sent with
     * no target, down the responder chain to the focused view, its window
     * or the application, exactly as the built-in menus do, and AppKit
     * enables the item only while something in that chain responds to it.
     * The standard menus use `orderFrontStandardAboutPanel:`, `hide:`,
     * `hideOtherApplications:`, `unhideAllApplications:`, `terminate:`,
     * `undo:`, `redo:`, `cut:`, `copy:`, `paste:`, `delete:`, `selectAll:`,
     * `toggleFullScreen:`, `performMiniaturize:`, `performZoom:` and
     * `arrangeInFront:`; any other action method a responder implements
     * (`performClose:`, `print:`, `centerSelectionInVisibleArea:`, one of a
     * class defined with {@link ObjC.defineClass}) works the same way.
     */
    action?: string | (() => void);
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
     * Whether the item can be chosen; `false` builds it with no target or
     * action, greyed out. Items with a selector `action` are otherwise
     * validated by AppKit.
     * @default true
     */
    enabled?: boolean;
    /** Draw a check mark next to the item (`-[NSMenuItem state]` on). @default false */
    checked?: boolean;
    /** Nested items shown as a submenu of this item (`-[NSMenuItem submenu]`). */
    submenu?: ReadonlyArray<MenuItem | MenuSeparator>;
  }

  /**
   * One top-level menu in the menu bar: an `NSMenu` under an item of the
   * main menu. The first menu in {@link App.menu} is always the application
   * menu (macOS shows it under the app's name whatever its `title`).
   */
  export interface MenuSpec {
    title: string;
    items: ReadonlyArray<MenuItem | MenuSeparator>;
  }

  export interface AppEventMap {
    /**
     * The user asked to quit (Cmd-Q, the Dock menu, a logout, or
     * {@link App.quit}). Call `event.preventDefault()` or return `false` to
     * cancel; a listener that throws is reported like an uncaught error and
     * neither cancels nor hides another listener's veto. These run in
     * `bun:objc`'s `"beforequit"` round with any listener added there, so
     * nothing has been touched yet whichever one cancels. If no listener
     * cancels, every open window's {@link Window.shouldClose} is asked next
     * (hidden and minimized ones too), oldest first, and the first `false`
     * stops the quit there; otherwise every window closes and the process
     * exits as `process.exit()` would (`process.on("exit")` runs, the code
     * is `process.exitCode`): at the next turn of the event loop for
     * {@link App.quit}, before AppKit's terminate returns for the others.
     * Once a quit is accepted, later requests do not fire this again.
     */
    beforequit: [event: QuitEvent];
    /**
     * The Dock icon was clicked while the app was already running.
     * `hasVisibleWindows` is what AppKit reports; a typical handler shows a
     * window when it is `false`.
     */
    reopen: [hasVisibleWindows: boolean];
    /** A custom menu item (one with a function to call, or no `action`) was chosen. */
    menu: [item: MenuItem];
  }

  /**
   * The application object. AppKit starts lazily the first time a
   * {@link Window} is created, {@link App.keepAlive} is set, or
   * {@link App.activate} is called; set {@link App.activationPolicy}
   * before that if you want to change it. Reading properties never starts
   * it. Written over {@link ObjC.app `app` in `bun:objc`}, which has the parts this
   * leaves out (the application delegate, keep-alive tokens, an explicit
   * `start()`); the menu bar, `name` and the windows are this layer's.
   */
  export interface App {
    /**
     * The name used in the standard menus ("About …", "Quit …"). Defaults to
     * the executable's name; assigning `null` restores that.
     */
    get name(): string;
    set name(value: string | null);
    /**
     * @default "regular"
     */
    activationPolicy: ActivationPolicy;
    /**
     * Keep the process alive even when no window is open (for menu-bar style
     * utilities, or apps that reopen a window from the Dock). Setting it to
     * `true` starts the application so that it can receive events. A quit
     * that nothing vetoes ends the process regardless.
     * @default false
     */
    keepAlive: boolean;
    /** Text drawn on the Dock tile, or `null` for none. A number is converted. */
    get badge(): string | null;
    set badge(value: string | number | null);
    /**
     * The menu bar (`-[NSApplication mainMenu]`, built out of `NSMenu` and
     * `NSMenuItem` once the application starts). `null` installs the
     * standard application, Edit, View and Window menus so text editing
     * shortcuts, full screen and Cmd-Q work out of the box; an array
     * replaces the whole menu bar, so include the standard items you want
     * to keep. Assigning builds a new main menu each time; reading gives
     * back the array assigned (its functions cannot be read back out of an
     * `NSMenu`), so editing that array in place changes nothing until it is
     * assigned again. To change one item of the installed bar (enable,
     * check, retitle it) without a rebuild, message its `NSMenuItem`:
     * {@link App.menuItem}.
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
    /**
     * The `NSMenuItem` the installed menu bar has for `item`: one of the
     * item objects inside {@link App.menu} (matched by identity), or one of
     * its top-level menus (the item of the main menu whose `submenu()` is
     * that `NSMenu`). `null` before the application has started, for the
     * standard bar, or for an object that is not part of the bar installed
     * now. `setTitle:`, `setState:`, `setKeyEquivalent:` and the rest apply
     * at once; `setEnabled:` lasts only while the item's menu has
     * `autoenablesItems` off, because AppKit re-validates items with a
     * target each time a menu opens (`-[NSMenu setAutoenablesItems:]`).
     *
     * @example
     * ```ts
     * const wrap = { title: "Word Wrap", onClick: () => toggleWrap() };
     * app.menu = [{ title: app.name, items: [] }, { title: "View", items: [wrap] }];
     * app.menuItem(wrap)?.setState_(objc.enums.NSControlStateValueOn);
     * app.menuItem(wrap)?.setTitle_("Wrap Lines");
     * ```
     */
    menuItem(item: MenuItem | MenuSpec): ObjCObject | null;
    /** Every window that has been created and not yet closed. */
    readonly windows: readonly Window[];
    /** Whether the app's effective appearance is dark. `false` until the application has started. */
    readonly isDark: boolean;
    /**
     * `false` when no screen is attached (over `ssh`, on CI agents, inside a
     * sandbox). Windows still work there (layout, events and `snapshot()`)
     * but nothing is ever shown. Does not start the application.
     */
    readonly hasDisplay: boolean;
    /** Whether the application has started on this thread. */
    readonly isRunning: boolean;
    /** Start AppKit if needed and bring the app to the foreground. */
    activate(): void;
    /** Hide every window of the app (like Cmd-H). */
    hide(): void;
    /**
     * Ask to quit, exactly as Cmd-Q does: see
     * {@link AppEventMap.beforequit `"beforequit"`}. Unless a listener or a
     * window's `shouldClose` cancels it, every window closes before this
     * returns and the process exits at the next turn of the event loop.
     * Before the application has started this is `process.exit()`.
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
    /** `-title`. @default "" */
    title?: string;
    /** Content width (`contentRectForFrameRect:` of the frame). @default 480 */
    width?: number;
    /** Content height. @default 320 */
    height?: number;
    /** Screen x of the window's bottom-left corner. Omit both `x` and `y` to centre. */
    x?: number;
    /** Screen y of the window's bottom-left corner (origin at the bottom of the screen). */
    y?: number;
    /**
     * Size limits for the content. They bound user resizing, content-driven
     * growth, the initial size and later `width`/`height` assignments alike;
     * where a minimum exceeds a maximum the minimum wins.
     * @default null
     */
    minWidth?: number | null;
    /** @default null */
    minHeight?: number | null;
    /** @default null */
    maxWidth?: number | null;
    /** @default null */
    maxHeight?: number | null;
    /**
     * Whether the user can resize the window (`NSWindowStyleMaskResizable`,
     * which also lets it go full screen). Content that needs more room and
     * `width`/`height` assignments still can.
     * @default true
     */
    resizable?: boolean;
    /** `NSWindowStyleMaskClosable`. @default true */
    closable?: boolean;
    /** `NSWindowStyleMaskMiniaturizable`. @default true */
    minimizable?: boolean;
    /**
     * Let the content extend under the title bar (`NSWindowStyleMaskFullSizeContentView`).
     * @default false
     */
    fullSizeContent?: boolean;
    /** `-titlebarAppearsTransparent`. @default false */
    titlebarTransparent?: boolean;
    /** Hide the title text (the bar itself stays): `-titleVisibility`. @default false */
    titleHidden?: boolean;
    /** Window background colour (`-backgroundColor`). @default "windowBackground" */
    background?: Color;
    /** Opacity of the whole window from 0 to 1 (`-alphaValue`). @default 1 */
    alpha?: number;
    /**
     * A name under which AppKit saves and restores the window's frame between
     * launches (`setFrameAutosaveName:`): a frame saved under it wins over the
     * size and position given. Only one open window may use a name at a time.
     * @default null
     */
    restoreName?: string | null;
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
   * An `NSWindow`, made and driven through {@link objc} like the views are:
   * every option is a property afterwards that reads and writes the window
   * itself ({@link Window.native} is that very object), and the events come
   * from its notifications (`NSWindowDidResizeNotification`, …), so its
   * delegate is yours to set through `.native`. `shouldClose` is the
   * window's own `windowShouldClose:`: a delegate of yours that implements
   * that selector answers the close button instead. Creating a window
   * starts AppKit if it has not started yet. It is shown as soon as it is
   * created unless `visible: false` is passed; call {@link Window.show} to
   * show it later.
   *
   * The root {@link Window.content view} is pinned to the window's edges. A
   * `VStack` whose children do not {@link View.grow grow} sits at the top at
   * its natural height; a `ScrollView`, `SplitView` or growing stack fills
   * the window. Content that needs more width or height than the window has
   * grows the window (up to `maxWidth`/`maxHeight`); content that fits
   * leaves its size alone.
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
    /** `-title`, live; `null` clears it. */
    get title(): string;
    set title(value: string | null | undefined);
    /** Content width in points, live, with pending layout applied first. Assignments are clamped into the size limits; `null` assigns the default. */
    get width(): number;
    set width(value: number | null | undefined);
    /** Content height in points, live. Assignments are clamped into the size limits; `null` assigns the default. */
    get height(): number;
    set height(value: number | null | undefined);
    /** Screen x of the bottom-left corner (`-frame`), live. Assigning `null` to `x` or `y` centres the window. */
    get x(): number;
    set x(value: number | null | undefined);
    /** Screen y of the bottom-left corner, live. */
    get y(): number;
    set y(value: number | null | undefined);
    /**
     * See {@link WindowOptions.minWidth}. `-contentMinSize` /
     * `-contentMaxSize`, live: no limit reads `null`, and a limit set
     * through {@link Window.native} shows here. The values assigned are
     * what a later assignment on the same axis settles again: where a
     * minimum exceeds a maximum the minimum wins, so that maximum reads
     * back raised to it until either changes. Lowering a maximum under the
     * current size shrinks the window to it.
     */
    minWidth: number | null;
    minHeight: number | null;
    maxWidth: number | null;
    maxHeight: number | null;
    /** As assigned; `null` puts the standard window background back. */
    background: Color;
    /** `-alphaValue`, live; assignments are clamped to 0–1. */
    alpha: number;
    /** `NSWindowStyleMaskResizable` in `-styleMask`, live like the other style-mask flags. */
    resizable: boolean;
    closable: boolean;
    minimizable: boolean;
    fullSizeContent: boolean;
    /** `-titlebarAppearsTransparent`, live. */
    titlebarTransparent: boolean;
    /** Whether `-titleVisibility` is `NSWindowTitleHidden`, live. */
    titleHidden: boolean;
    /**
     * `-frameAutosaveName`, live (`""` reads as `null`). Assigning a name
     * restores a frame saved under it; a closed window gives its name up.
     * @throws ERR_INVALID_STATE if another open window uses the name.
     */
    restoreName: string | null;
    /** The root view, or `null` for an empty window. */
    content: View | null;
    /** `-isVisible`: whether the window is on screen. Assigning calls {@link Window.show} or {@link Window.hide}. */
    visible: boolean;
    /**
     * Whether the window has been closed. A closed window cannot be shown
     * again, and assigning any of its properties throws `ERR_INVALID_STATE`;
     * the getters and {@link Window.native} keep answering.
     */
    readonly closed: boolean;
    /** `-isKeyWindow`: whether this is the key window (the one receiving keyboard input). */
    readonly key: boolean;
    /**
     * The `NSWindow` behind this window, for anything the properties above
     * do not cover: the same handle every read, and the one this `Window`
     * itself works through, so do not {@link ObjCObject.release release()}
     * it. See `bun:objc`. Still the window after {@link Window.close} (an
     * `NSWindow` outlives its close), so an `onClose` handler can read its
     * last frame or screen.
     *
     * @example
     * ```ts
     * win.native.setTitle_("Renamed"); // win.title reads "Renamed"
     * win.native.frame();              // { origin: { x, y }, size: { width, height } }
     * ```
     */
    readonly native: objc.NSWindow;
    /** Put the window on screen and make it key (`makeKeyAndOrderFront:`); the first call also brings the app to the front. */
    show(): void;
    /** Take the window off screen without closing it (`orderOut:`). */
    hide(): void;
    /** Centre the window on its screen (`center`). */
    center(): void;
    /** Make the window key and bring it and the app to the front. */
    focus(): void;
    /**
     * Close the window (`close`) without asking {@link Window.shouldClose}.
     * The content view leaves the window and keeps working (it can go into
     * another one); {@link Window.onClose} fires; when this was the last
     * open window and {@link App.keepAlive} is `false` the process can
     * exit. Calling `close()` again does nothing.
     */
    close(): void;
    /**
     * PNG bytes of the window's content area (no title bar) as currently
     * laid out, shown or not and with or without a display, or `null`
     * while the content area has no size.
     */
    snapshot(): Uint8Array | null;
    /** Called after the window has closed (`NSWindowWillCloseNotification`), whether by the user, a quit, or {@link Window.close}. */
    onClose: (() => void) | null | undefined;
    /**
     * The window's own `windowShouldClose:`: called when the user clicks
     * the close button (unless a delegate you set on `.native` implements
     * that selector, which then decides), and for every open window when
     * the app is asked to quit. Return `false` to keep the window open
     * (and, during a quit, cancel the quit); a handler that throws is
     * reported and does not. Not consulted by {@link Window.close}.
     */
    shouldClose: (() => boolean) | null | undefined;
    /**
     * `NSWindowDidResizeNotification`: called with the new content size after the user
     * resizes the window, it zooms or enters full screen, or its content
     * makes it grow. Not called for the program's own
     * `width`/`height`/size-limit assignments.
     */
    onResize: ((size: Size) => void) | null | undefined;
    /**
     * `NSWindowDidMoveNotification`: called with the new bottom-left screen position
     * after the user moves the window. Not called for `x`/`y` assignments
     * or {@link Window.center}.
     */
    onMove: ((position: Point) => void) | null | undefined;
    /** `NSWindowDidBecomeKeyNotification`: the window became the key window. */
    onFocus: (() => void) | null | undefined;
    /** `NSWindowDidResignKeyNotification`: the window stopped being the key window. */
    onBlur: (() => void) | null | undefined;
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
     * `-hidden`. Hidden views take no space in a stack.
     * @default false
     */
    hidden?: boolean;
    /**
     * `-alphaValue`, from 0 to 1.
     * @default 1
     */
    alpha?: number;
    /** `-toolTip`: help text shown on hover. @default null */
    tooltip?: string | null;
    /** `-identifier` (also the accessibility identifier). @default null */
    id?: string | null;
    /** Fixed width (a width constraint at priority 999), or `null` for natural width. @default null */
    width?: number | null;
    /** Fixed height, likewise, or `null` for natural height. @default null */
    height?: number | null;
    /**
     * Lower and upper bounds on the size. Where a minimum exceeds a maximum
     * the minimum wins, and `width`/`height` are clamped between them,
     * whichever order they are assigned in.
     * @default null
     */
    minWidth?: number | null;
    /** @default null */
    maxWidth?: number | null;
    /** @default null */
    minHeight?: number | null;
    /** @default null */
    maxHeight?: number | null;
    /**
     * The view's share of leftover space along its parent's axis. `0` keeps
     * the natural size. In a `VStack`, `HStack` or `Group` with the default
     * `"fill"` distribution, siblings with `grow > 0` split the leftover
     * length in proportion to their values (this works for views with no
     * natural size, such as nested stacks, too). In a `SplitView` the pane
     * with the larger `grow` is the one that absorbs a window resize or
     * divider drag. As a window's root, a growing view fills the window.
     * @default 0
     */
    grow?: number;
    /**
     * Fill colour of the view's layer (`layer.backgroundColor`). A system
     * colour name is resolved for the view's appearance at the time it is set.
     * @default null
     */
    background?: Color | null;
    /** `layer.cornerRadius`; rounds the view's corners (and clips the background to them). @default 0 */
    cornerRadius?: number;
    /** `layer.borderWidth` / `layer.borderColor`. @default null */
    border?: Border | null;
  }

  /**
   * Base class of every view. Not constructible directly; use one of the
   * concrete views below.
   *
   * `hidden`, `alpha`, `tooltip`, `id` and `cornerRadius` read the view
   * ({@link View.native}); the sizes, `grow`, `background` and `border`
   * read back the last value assigned, or their documented default while
   * unset. Assigning `null` returns a prop to its default.
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
     * The view's frame in its parent's coordinates. Reading it lays the
     * window out first, so it reflects every change made so far; all zeros
     * while the view is not in a window.
     */
    readonly frame: Rect;
    /**
     * The `NSView` this view is, for anything the props do not cover: the
     * object the class built through {@link objc} (an `NSButton`, an
     * `NSStackView`, ...), which its readable props and the common ones
     * (`hidden`, `width`, `grow`, `frame`, ...) read and write. For
     * {@link ScrollView}, {@link Table} and {@link TextEditor} this is the
     * outer `NSScrollView`; `.documentView()` reaches the content, the
     * `NSTableView` or the `NSTextView`. For {@link Group} it is the `NSBox`,
     * whose children sit in an `NSStackView` inside its `contentView()`. For
     * {@link MetalView} it is the `MTKView`, or a plain `NSView` when Metal
     * is unavailable. Every read gives the same handle, and it is the one
     * the view itself works through, so do not
     * {@link ObjCObject.release release()} it. See `bun:objc`.
     *
     * What keeps a `View` and its handlers alive is your reference to it
     * or its place in a {@link Window}'s content or a container's
     * {@link Container.children children}; the `NSView` refers back only
     * weakly. Adding this handle to a superview yourself
     * (`other.addSubview_(view.native)`) does not count: once nothing else
     * references the `View` it is collected, the `NSView` stays where you
     * put it, and its `onClick`/`onChange` stop (a {@link Table} then
     * answers no rows). Keep such a view in a variable for as long as it
     * should work. `parent` and `window` report the curated tree, not the
     * native one.
     */
    readonly native: objc.NSView;
    /** Remove the view from its parent (no-op when it has none). */
    remove(): void;
    /** PNG bytes of the view as currently drawn, or `null` before it has a size. */
    snapshot(): Uint8Array | null;
  }

  /** Properties every container has. */
  export interface ContainerProps extends ViewProps {
    /** The initial children, as if appended in order. @default [] */
    children?: readonly View[];
  }

  /**
   * A view that holds other views.
   *
   * @category AppKit
   */
  export abstract class Container extends View {
    /** Child views in display order. Assigning is {@link Container.replaceChildren}. */
    get children(): readonly View[];
    set children(views: readonly View[]);
    /** Add views at the end. A view can only be in one container at a time. */
    append(...views: View[]): void;
    /**
     * Insert `view` before `ref`, or at the end when `ref` is `null`. A view
     * that is already a child of this container is moved in place and keeps
     * its focus and editing state. Throws, changing nothing, if `ref` is not
     * a child or `view` belongs to another container.
     */
    insertBefore(view: View, ref: View | null): void;
    /** Remove a direct child. */
    removeChild(view: View): void;
    /**
     * Make `views` the children, in that order: views already here are moved,
     * the rest are removed or added. Throws, changing nothing, if a view is
     * listed twice or belongs to another container.
     */
    replaceChildren(...views: View[]): void;
  }

  /** Properties shared by {@link VStack}, {@link HStack} and {@link Group} (an `NSStackView`). */
  export interface StackProps extends ContainerProps {
    /** `-spacing`: gap between adjacent children. @default 8 */
    spacing?: number;
    /** `-edgeInsets`: inset between the stack's edges and its children; reads back as `{ top, left, bottom, right }`. @default 0 on every edge */
    padding?: Padding;
    /**
     * Cross-axis placement of children (`-alignment`, plus a width or
     * height constraint per child for `"fill"`): an {@link Align} name, or
     * any `NSLayoutAttribute` by Apple's name or number.
     * @default "fill" for VStack and Group, "center" for HStack
     */
    align?: Align | NSLayoutAttributeName | number;
    /**
     * `-distribution`: a {@link Distribution} name, any
     * `NSStackViewDistribution` member by Apple's name (`"gravityAreas"`,
     * `"NSStackViewDistributionFillEqually"`), or its number.
     * @default "fill"
     */
    distribution?: Distribution | NSStackViewDistributionName | number;
  }

  export interface VStackProps extends StackProps {}
  export interface HStackProps extends StackProps {}

  /**
   * Lays children out top to bottom.
   *
   * @example
   * ```ts
   * const form = new VStack({ spacing: 12, padding: 20 });
   * form.append(new TextField({ placeholder: "Name" }), new Button({ title: "OK", keyEquivalent: "\r" }));
   * ```
   *
   * @category AppKit
   */
  export class VStack extends Container {
    constructor(props?: VStackProps);
    readonly native: objc.NSStackView;
    spacing: number;
    /** `-edgeInsets`. */
    get padding(): Required<Insets>;
    set padding(value: Padding | null | undefined);
    /** `-alignment`: see {@link Align}. */
    get align(): Align | NSLayoutAttributeName | number;
    set align(value: Align | NSLayoutAttributeName | number | null | undefined);
    get distribution(): Distribution | number;
    set distribution(value: Distribution | NSStackViewDistributionName | number | null | undefined);
  }

  /**
   * Lays children out leading to trailing.
   *
   * @category AppKit
   */
  export class HStack extends Container {
    constructor(props?: HStackProps);
    readonly native: objc.NSStackView;
    spacing: number;
    /** `-edgeInsets`. */
    get padding(): Required<Insets>;
    set padding(value: Padding | null | undefined);
    /** `-alignment`: see {@link Align}. */
    get align(): Align | NSLayoutAttributeName | number;
    set align(value: Align | NSLayoutAttributeName | number | null | undefined);
    get distribution(): Distribution | number;
    set distribution(value: Distribution | NSStackViewDistributionName | number | null | undefined);
  }

  export interface ZStackProps extends ContainerProps {}

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
    /**
     * `-title`, drawn above the box; empty for none (`NSNoTitle`). A title
     * position set through `.native` (`setTitlePosition:`) is kept when the
     * title changes; only `""` hides it, and the next title shows it at the top.
     * @default ""
     */
    title?: string;
    /** Inset between the box's border and its children. @default 4 on every edge */
    padding?: Padding;
  }

  /**
   * A titled box (`NSBox`) whose children are stacked vertically.
   *
   * @category AppKit
   */
  export class Group extends Container {
    constructor(props?: GroupProps);
    readonly native: objc.NSBox;
    title: string;
    spacing: number;
    /** `-edgeInsets`. */
    get padding(): Required<Insets>;
    set padding(value: Padding | null | undefined);
    /** `-alignment`: see {@link Align}. */
    get align(): Align | NSLayoutAttributeName | number;
    set align(value: Align | NSLayoutAttributeName | number | null | undefined);
    get distribution(): Distribution | number;
    set distribution(value: Distribution | NSStackViewDistributionName | number | null | undefined);
  }

  export interface ScrollBars {
    /** `-hasHorizontalScroller`. @default false */
    horizontal?: boolean;
    /** `-hasVerticalScroller`. @default true */
    vertical?: boolean;
  }

  export interface ScrollViewProps extends ContainerProps {
    /**
     * Which scrollers to show (they auto-hide when not needed): both flags,
     * one boolean for both, or `"none"`, `"horizontal"`, `"vertical"`,
     * `"both"`. Without a horizontal scroller the content is held to the
     * view's width, so text wraps. Reads back both flags from the view.
     */
    scrollBars?: ScrollBars | boolean | "none" | "horizontal" | "vertical" | "both";
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
    readonly native: objc.NSScrollView;
    get scrollBars(): ScrollBars;
    set scrollBars(value: ScrollBars | boolean | "none" | "horizontal" | "vertical" | "both" | null | undefined);
  }

  export interface SplitViewProps extends ContainerProps {
    /**
     * `false` puts panes side by side with vertical dividers (NSSplitView's
     * `vertical = YES`); `true` stacks them top to bottom. Reads the view.
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
    readonly native: objc.NSSplitView;
    vertical: boolean;
  }

  export interface TextProps extends ViewProps {
    /** `-stringValue`. @default "" */
    text?: string;
    /** `-font`. @default null (the standard label font) */
    font?: Font | null;
    /** `-textColor`. @default null ("label") */
    color?: Color | null;
    /** `-alignment`, by name or `NSTextAlignment` value. @default "natural" */
    textAlign?: TextAlign | number;
    /** `-selectable`: let the user select and copy the text. @default false */
    selectable?: boolean;
    /**
     * `-maximumNumberOfLines`, a non-negative integer; longer text is
     * truncated with an ellipsis. `0` wraps onto as many lines as needed.
     * @default 1
     */
    lineLimit?: number;
  }

  /**
   * A non-editable text label (`NSTextField`). `text`, `textAlign`,
   * `selectable` and `lineLimit` read the label itself, so a change made
   * through {@link View.native} shows; `font` and `color` read as last
   * assigned.
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
    constructor(props?: TextProps | string);
    readonly native: objc.NSTextField;
    text: string;
    font: Font | null;
    color: Color | null;
    /** The short `NSTextAlignment` name, or the number for a value with none. */
    get textAlign(): TextAlign | number;
    set textAlign(value: TextAlign | number | null | undefined);
    selectable: boolean;
    lineLimit: number;
  }

  export interface ButtonProps extends ViewProps {
    /** `-title`. @default "" */
    title?: string;
    /** `-bezelStyle`: the button's shape, by name or `NSBezelStyle` value. @default "push" */
    bezelStyle?: BezelStyle | number;
    /** `-bordered`: `false` draws the title alone, like a link. @default true */
    bordered?: boolean;
    /** `-hasDestructiveAction`: lets AppKit mark the button as destructive (red where the bezel style shows it). @default false */
    hasDestructiveAction?: boolean;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** An SF Symbol name drawn before the title (`-image`), e.g. `"plus"`. @default null */
    symbol?: string | null;
    /**
     * `-keyEquivalent`: the key that activates the button while its window
     * is key, e.g. `"\r"` (Return, which also makes it the window's default
     * button, drawn in the accent colour, and activates it from a text field
     * that has no `onSubmit`) or `"\u001b"` (Escape). `null` and `""` mean none.
     * @default null
     */
    keyEquivalent?: string | null;
    /** `-font`. @default null (the standard control font) */
    font?: Font | null;
    /** `-contentTintColor`: tint for the title and symbol. @default null */
    tint?: Color | null;
    /**
     * The button's action (`target`/`action`): called when it is clicked or
     * its key equivalent is pressed, synchronously, inside the click.
     */
    onClick?: () => void;
  }

  /**
   * A push button (`NSButton`). `title`, `bezelStyle`, `bordered`,
   * `hasDestructiveAction`, `keyEquivalent` and `enabled` read the button
   * itself, so a change made through `.native` shows in them.
   *
   * @example
   * ```ts
   * new Button({ title: "Save", keyEquivalent: "\r", onClick: () => save() }); // the default button
   * new Button({ symbol: "trash", hasDestructiveAction: true, onClick: () => remove() });
   * new Button({ title: "Docs", bordered: false }); // like a link
   * new Button({ title: "Options", bezelStyle: "toolbar" });
   * ```
   *
   * @category AppKit
   */
  export class Button extends View {
    constructor(props?: ButtonProps | string);
    readonly native: objc.NSButton;
    title: string;
    /** Reads the name for the button's `-bezelStyle`, or the number when {@link BezelStyle} has none for it. */
    get bezelStyle(): BezelStyle | number;
    set bezelStyle(value: BezelStyle | number | null | undefined);
    bordered: boolean;
    hasDestructiveAction: boolean;
    enabled: boolean;
    symbol: string | null;
    keyEquivalent: string | null;
    font: Font | null;
    tint: Color | null;
    onClick: (() => void) | null | undefined;
    /** Act as if the user clicked the button (`performClick:`: highlights, then fires `onClick`). */
    click(): void;
  }

  export interface ToggleProps extends ViewProps {
    /** `-title`. @default "" */
    title?: string;
    /** `-state` is on. Assigning it does not fire `onChange`. @default false */
    checked?: boolean;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** `-font`. @default null (the standard control font) */
    font?: Font | null;
  }

  export interface CheckboxProps extends ToggleProps {
    /** The checkbox's action: called with the new state after the user toggles it. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * A checkbox with a title (`NSButton`). `title`, `checked` and `enabled`
   * read the control itself.
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
    readonly native: objc.NSButton;
    title: string;
    /** Whether the checkbox is on, as the user left it. */
    checked: boolean;
    enabled: boolean;
    font: Font | null;
    onChange: ((checked: boolean) => void) | null | undefined;
    /** Toggle as if clicked. */
    click(): void;
  }

  export interface RadioProps extends ToggleProps {
    /** Called with the new state after the user clicks the radio button. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * A radio button with a title. Radios that are direct children of the same
   * container act as one group: turning one on (by click or by assigning
   * `checked`) turns the others in that container off, and only the one that
   * was clicked fires `onChange`. Radios in different containers are
   * independent.
   *
   * @category AppKit
   */
  export class Radio extends View {
    constructor(props?: RadioProps);
    readonly native: objc.NSButton;
    title: string;
    checked: boolean;
    enabled: boolean;
    font: Font | null;
    onChange: ((checked: boolean) => void) | null | undefined;
    click(): void;
  }

  export interface SwitchProps extends ViewProps {
    /** `-state` is on. Assigning it does not fire `onChange`. @default false */
    checked?: boolean;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** The switch's action: called with the new state after the user flips it. */
    onChange?: (checked: boolean) => void;
  }

  /**
   * An on/off switch (`NSSwitch`). `checked` and `enabled` read the control itself.
   *
   * @category AppKit
   */
  export class Switch extends View {
    constructor(props?: SwitchProps);
    readonly native: objc.NSSwitch;
    checked: boolean;
    enabled: boolean;
    onChange: ((checked: boolean) => void) | null | undefined;
    click(): void;
  }

  export interface TextFieldProps extends ViewProps {
    /** `-stringValue`. @default "" */
    value?: string;
    /** `-placeholderString`: greyed hint shown while empty. @default null */
    placeholder?: string | null;
    /** `-editable`. @default true */
    editable?: boolean;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** `-font`. @default null */
    font?: Font | null;
    /** `-alignment`, by name or `NSTextAlignment` value. @default "natural" */
    textAlign?: TextAlign | number;
    /**
     * `true` calls `onChange` on every keystroke; `false` only when editing
     * ends.
     * @default true
     */
    continuous?: boolean;
    /**
     * Called with the field's text when the user changes it
     * (`NSControlTextDidChangeNotification`; the field's delegate is left
     * for you to set). Assigning {@link TextField.value} from code
     * does not call it. With `continuous: false` it is called once when
     * editing ends or Return is pressed, and not at all if the value was
     * assigned from code in between.
     */
    onChange?: (value: string) => void;
    /**
     * Called with the field's text when the user presses Return (the
     * field's target/action). A field without an `onSubmit` handler lets
     * Return press the window's default button (the one whose
     * `keyEquivalent` is Return) instead, as in a native dialog.
     */
    onSubmit?: (value: string) => void;
    /** Called when the field starts editing: it has keyboard focus and the user types (`NSControlTextDidBeginEditingNotification`). */
    onFocus?: () => void;
    /**
     * Called when editing ends (`NSControlTextDidEndEditingNotification`): focus leaves
     * the field, Return is pressed, or the program ends it (hiding or
     * removing the field, replacing the window's content, closing the
     * window). Delivered before that call returns, and before the window's
     * `onClose` when a close ended it.
     */
    onBlur?: () => void;
  }

  /**
   * A single-line text input (`NSTextField`). `value`, `placeholder`,
   * `editable`, `enabled` and `textAlign` read the field itself; its events
   * come from an `NSTextFieldDelegate` and the field's target/action, which
   * the class installs (replacing either through {@link View.native} ends
   * them).
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
    readonly native: objc.NSTextField;
    /** The current text, including edits the user has made. */
    value: string;
    placeholder: string | null;
    editable: boolean;
    enabled: boolean;
    font: Font | null;
    /** The short `NSTextAlignment` name, or the number for a value with none. */
    get textAlign(): TextAlign | number;
    set textAlign(value: TextAlign | number | null | undefined);
    continuous: boolean;
    onChange: ((value: string) => void) | null | undefined;
    onSubmit: ((value: string) => void) | null | undefined;
    onFocus: (() => void) | null | undefined;
    onBlur: (() => void) | null | undefined;
  }

  export interface SecureFieldProps extends TextFieldProps {}

  /**
   * A password input that shows bullets instead of the text (`NSSecureTextField`).
   *
   * @category AppKit
   */
  export class SecureField extends TextField {
    constructor(props?: SecureFieldProps);
    readonly native: objc.NSSecureTextField;
  }

  export interface SearchFieldProps extends TextFieldProps {}

  /**
   * A rounded search input with a magnifier icon and a clear button
   * (`NSSearchField`). `onSubmit` fires for Return or the search button, not
   * while typing pauses.
   *
   * @category AppKit
   */
  export class SearchField extends TextField {
    constructor(props?: SearchFieldProps);
    readonly native: objc.NSSearchField;
  }

  export interface TextEditorProps extends ViewProps {
    /** `-string`. @default "" */
    value?: string;
    /** `-editable`. @default true */
    editable?: boolean;
    /** `-font`. @default null (the standard system font; pass `{ design: "monospaced" }` for code) */
    font?: Font | null;
    /** `-textColor`. @default null (the system text colour) */
    color?: Color | null;
    /**
     * Called with the full text after each user edit
     * (`NSTextDidChangeNotification`). Assigning {@link TextEditor.value}
     * from code does not call it. The text view's delegate is the editor's
     * own (it hands each editor its undo manager); replacing it merges the
     * editor's undo into the window's.
     */
    onChange?: (value: string) => void;
  }

  /**
   * A multi-line, scrolling plain-text editor with undo: the `NSTextView`
   * inside the `NSScrollView` that `+[NSTextView scrollableTextView]`
   * makes ({@link View.native} is the scroll view, `.documentView()` the
   * text view). `value` and `editable` read the text view; `onChange` comes
   * from an `NSTextViewDelegate` the class installs, which also gives the
   * view an undo manager of its own. Give it a size or `grow` so it has
   * room.
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
    readonly native: objc.NSScrollView;
    /** `-string`: the current text, including edits the user has made. */
    value: string;
    /** `-isEditable`. */
    editable: boolean;
    font: Font | null;
    color: Color | null;
    onChange: ((value: string) => void) | null | undefined;
  }

  export interface SliderProps extends ViewProps {
    /** `-doubleValue`. @default 0 */
    value?: number;
    /** `-minValue`. @default 0 */
    min?: number;
    /** `-maxValue`. @default 1 */
    max?: number;
    /**
     * Snap to multiples of `step` above `min` (and show tick marks when the
     * range is a whole number of steps). `0` allows any value.
     * @default 0
     */
    step?: number;
    /**
     * `-continuous`: `true` calls `onChange` continuously while dragging;
     * `false` once on release.
     * @default true
     */
    continuous?: boolean;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** Called with the new value when the user moves the slider (its target/action). */
    onChange?: (value: number) => void;
  }

  /**
   * A horizontal slider (`NSSlider`). `value`, `min`, `max`, `continuous`
   * and `enabled` read the slider itself.
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
    readonly native: objc.NSSlider;
    /** The current value, as the user left it. */
    value: number;
    min: number;
    max: number;
    step: number;
    continuous: boolean;
    enabled: boolean;
    onChange: ((value: number) => void) | null | undefined;
  }

  export interface PickerProps extends ViewProps {
    /** `-itemTitles`: the choices, in order (one menu item each). @default [] */
    items?: readonly string[];
    /** `-indexOfSelectedItem`, `-1` for none. @default 0 once there are items, -1 while `items` is empty */
    selectedIndex?: number;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** Called with the index the user picked (the button's target/action). */
    onChange?: (index: number) => void;
  }

  /**
   * A pop-up button that picks one item from a list (`NSPopUpButton`).
   * `items`, `selectedIndex` and `enabled` read the button itself; an index
   * assigned before there are enough items takes effect once there are.
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
    readonly native: objc.NSPopUpButton;
    items: readonly string[];
    /** The selected index as the user left it, `-1` for none. */
    selectedIndex: number;
    enabled: boolean;
    onChange: ((index: number) => void) | null | undefined;
  }

  export interface SegmentedProps extends ViewProps {
    /** `-labelForSegment:`, one label per segment. @default [] */
    items?: readonly string[];
    /** `-selectedSegment`, `-1` for none. @default 0 once there are items, -1 while `items` is empty */
    selectedIndex?: number;
    /** `-enabled`. @default true */
    enabled?: boolean;
    /** Called with the index of the segment the user clicked (the control's target/action). */
    onChange?: (index: number) => void;
  }

  /**
   * A segmented control that selects one of a few options
   * (`NSSegmentedControl`, one segment selected at a time). `items`,
   * `selectedIndex` and `enabled` read the control itself.
   *
   * @category AppKit
   */
  export class Segmented extends View {
    constructor(props?: SegmentedProps);
    readonly native: objc.NSSegmentedControl;
    items: readonly string[];
    selectedIndex: number;
    enabled: boolean;
    onChange: ((index: number) => void) | null | undefined;
  }

  export interface ProgressProps extends ViewProps {
    /** `-doubleValue`; kept when a later `min`/`max` makes room for it. @default 0 */
    value?: number;
    /** `-minValue`. @default 0 */
    min?: number;
    /** `-maxValue`. @default 100 */
    max?: number;
    /**
     * `-indeterminate`: show indefinite activity instead of `value`.
     * @default false
     */
    indeterminate?: boolean;
    /**
     * Animate the indeterminate bar or spinner (`startAnimation:`).
     * @default true
     */
    running?: boolean;
    /**
     * `-style`: draw as a circular spinner instead of a bar.
     * @default false
     */
    spinner?: boolean;
  }

  /**
   * A progress bar or spinner (`NSProgressIndicator`). `value`, `min`, `max`,
   * `indeterminate` and `spinner` read the indicator itself.
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
    readonly native: objc.NSProgressIndicator;
    value: number;
    min: number;
    max: number;
    indeterminate: boolean;
    running: boolean;
    spinner: boolean;
  }

  export interface ImageProps extends ViewProps {
    /** `-image`. A file that does not load throws an `Error` whose `path` is the file. @default null */
    image?: ImageSource | null;
    /** `-imageScaling`, by name or `NSImageScaling` value. @default "down" */
    scaling?: ImageScaling | NSImageScalingName | number;
    /** `-contentTintColor`: tint for template images and SF Symbols. @default null */
    tint?: Color | null;
    /** Point size for an SF Symbol (`-symbolConfiguration`). @default 0 (the symbol's natural size) */
    size?: number;
    /** `-enabled`. @default true */
    enabled?: boolean;
  }

  /**
   * Displays an image file, image bytes, or an SF Symbol (`NSImageView`).
   * `scaling` and `enabled` read the view itself; `image` and `tint` read
   * what was assigned while the view still shows it, else the `NSImage` /
   * `NSColor` it has now; `size` reads as last assigned.
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
    readonly native: objc.NSImageView;
    image: ImageSource | null;
    /** The curated name, else the `NSImageScaling` name, or the number for a value with none. */
    get scaling(): ImageScaling | NSImageScalingName | number;
    set scaling(value: ImageScaling | NSImageScalingName | number | null | undefined);
    tint: Color | null;
    size: number;
    enabled: boolean;
  }

  export interface DividerProps extends ViewProps {
    /**
     * `true` for a vertical line, `false` for a horizontal one. `null` runs
     * across the parent's axis: vertical in an `HStack` or side-by-side
     * `SplitView`, horizontal in a `VStack`, `Group` or on its own, following
     * the divider when it moves.
     * @default null
     */
    vertical?: boolean | null;
  }

  /**
   * A one-pixel separator line (an `NSBox` of type separator).
   *
   * @category AppKit
   */
  export class Divider extends View {
    constructor(props?: DividerProps);
    readonly native: objc.NSBox;
    vertical: boolean | null;
  }

  export interface SpacerProps extends ViewProps {
    /** Minimum length along the enclosing stack's or split view's axis. @default 0 */
    minLength?: number;
  }

  /**
   * Empty, stretchable space inside a stack (a plain `NSView`): pushes the
   * views after it to the far edge. Spacers share leftover space like views with `grow: 1`
   * (a larger `grow` still applies), so one on each side of a view centres
   * it and two spacers split the space equally. In a `SplitView`,
   * `minLength` holds along the split's axis.
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

  /**
   * Any `NSView` made through `bun:objc`, adopted into the tree: it takes
   * the props every view has ({@link ViewProps}: `width`, `grow`, `hidden`,
   * `background`, …), goes in a container's `children` or a `Window`'s
   * `content`, and answers `frame`, `parent`, `window` and `snapshot()`.
   * What is specific to the control stays a message to `native`. The
   * `NSView` must not be in a view hierarchy yet (no superview, no window),
   * and one `NSView` makes one `NativeView`.
   *
   * @example
   * ```ts
   * import { objc } from "bun:objc";
   * const picker = objc.classes.NSDatePicker.alloc().initWithFrame_({ x: 0, y: 0, width: 0, height: 0 });
   * picker.setDateValue_(new Date());
   * new Window({ title: "When", content: new VStack({ children: [new NativeView(picker, { width: 220 })] }) });
   * ```
   *
   * @throws TypeError (`ERR_INVALID_ARG_TYPE`) when `native` is not an `NSView` handle;
   * `ERR_INVALID_STATE` when it already has a superview or window, or is another `NativeView`'s.
   * @category AppKit
   */
  export class NativeView<T extends objc.NSView = objc.NSView> extends View {
    constructor(native: T, props?: ViewProps);
    readonly native: T;
  }

  /** A column of a {@link Table} (an `NSTableColumn`). A bare string is shorthand for `{ title }`. */
  export interface TableColumn {
    /** `-identifier`; defaults to the title. */
    id?: string;
    /** `-title`: the header text. */
    title: string;
    /** `-width` in points; omit or `0` to size automatically. */
    width?: number;
  }

  /**
   * What {@link Table.rows} accepts: one inner array per row in column
   * order, a number or boolean showing as its text; a bare string or number
   * is a one-cell row.
   */
  export type TableRows = ReadonlyArray<ReadonlyArray<string | number | boolean> | string | number>;

  export interface TableProps extends ViewProps {
    /** `-tableColumns`. Without any the table has one untitled column, which reads as `[]`. @default [] */
    columns?: ReadonlyArray<TableColumn | string>;
    /**
     * Cell text ({@link TableRows}); a missing cell shows empty. The table's
     * data source reads a cell when its row is displayed
     * (`tableView:viewForTableColumn:row:`), so a large array is cheap to
     * assign; the rows are copied when assigned.
     * @default []
     */
    rows?: TableRows;
    /**
     * `-selectedRowIndexes`. Indexes past the last row are remembered and
     * selected once the rows reach them; a single-selection table keeps the
     * lowest.
     * @default []
     */
    selectedIndexes?: readonly number[];
    /** `-allowsMultipleSelection`. @default false */
    multiple?: boolean;
    /** `-headerView` shown or not. `null` shows it once `columns` are given and hides it for the implicit single column. @default null */
    headerVisible?: boolean | null;
    /** `-usesAlternatingRowBackgroundColors`. @default false */
    alternatingRows?: boolean;
    /** `-rowHeight` in points; `null` restores the system default. @default the system's (24 on current macOS) */
    rowHeight?: number | null;
    /** Called with the selected row indexes whenever the user changes the selection (`NSTableViewSelectionDidChangeNotification`). */
    onSelect?: (indexes: number[]) => void;
    /** Called with the row index when the user double-clicks a row (the table's `doubleAction`, reading `-clickedRow`). */
    onActivate?: (row: number) => void;
  }

  /**
   * A scrolling, multi-column table of text cells: a view-based
   * `NSTableView` inside an `NSScrollView` ({@link View.native} is the
   * scroll view, `.documentView()` the table). One script object the class
   * installs is the table's data source and delegate (a view-based table
   * gets its cells from the delegate, so both stay the table's own; do not
   * replace them), so `rows` stay in JavaScript and AppKit asks for a cell
   * as its row scrolls into sight;
   * `selectedIndexes`, `multiple`, `alternatingRows`, `rowHeight` and
   * `columns` read the table.
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
    readonly native: objc.NSScrollView;
    /**
     * `-tableColumns` as `{ id, title, width }` (title and width as they are
     * now, a column a script added to the `NSTableView` included, though its
     * cells stay empty); `[]` while the table has only its one untitled column.
     */
    get columns(): readonly Required<TableColumn>[];
    set columns(value: ReadonlyArray<TableColumn | string> | null | undefined);
    /** The rows as last assigned: a frozen copy, every cell as its text. */
    get rows(): ReadonlyArray<ReadonlyArray<string>>;
    set rows(value: TableRows | null | undefined);
    /** `-selectedRowIndexes`: the selection as the user left it. */
    get selectedIndexes(): readonly number[];
    set selectedIndexes(value: readonly number[] | null | undefined);
    /** `-allowsMultipleSelection`. */
    multiple: boolean;
    headerVisible: boolean | null;
    /** `-usesAlternatingRowBackgroundColors`. */
    alternatingRows: boolean;
    /** `-rowHeight`. */
    get rowHeight(): number;
    set rowHeight(value: number | null | undefined);
    onSelect: ((indexes: number[]) => void) | null | undefined;
    onActivate: ((row: number) => void) | null | undefined;
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
   * - `"shared"`: memory JavaScript can read and write directly. The default.
   *   (On Intel and AMD GPUs a shared texture is backed by Metal's managed
   *   mode; reads and writes behave the same.)
   * - `"private"`: GPU-only memory; fill it with a blit from a shared buffer
   *   or by rendering into it.
   */
  export type StorageMode = "shared" | "private";

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

  /**
   * A clear colour: a {@link Color} string or `[r, g, b, a]` components from
   * 0 to 1, in sRGB. A system colour name is resolved to its sRGB value for
   * the current appearance once, when given; Metal has no dynamic colours.
   */
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
   * The GPU failed to run a command buffer (a shader fault, a timeout), or
   * Metal could not create a resource. Thrown by {@link GpuFrame.commitAndWait};
   * returned by {@link GpuFrame.error} for a frame submitted with
   * {@link GpuFrame.commit}; and, for frames a {@link MetalView} committed,
   * reported as an uncaught error before the view's next `onFrame`.
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
   * (or calling {@link GpuBuffer.destroy}) mid-frame is safe.
   *
   * {@link GpuBuffer.write} and {@link GpuBuffer.read} never overlap the GPU:
   * if a committed frame that used the buffer is still running they block
   * until it finishes ({@link GpuBuffer.inFlight} says whether they would).
   * For a few KB of per-frame data prefer {@link GpuFrame.vertexBytes} /
   * {@link GpuFrame.bytes}, or rotate between two or three buffers.
   *
   * @category AppKit
   */
  export class GpuBuffer {
    private constructor();
    readonly byteLength: number;
    readonly storage: StorageMode;
    /** Whether a committed frame that used the buffer is still running on the GPU. */
    readonly inFlight: boolean;
    /** Whether {@link GpuBuffer.destroy} has been called. */
    readonly destroyed: boolean;
    /** Debug label shown in Xcode's GPU tools; `""` when unset. */
    label: string;
    /**
     * Copy `data` into the buffer at `offset` bytes, first waiting for any
     * committed frame that used the buffer to finish.
     * @throws RangeError if it does not fit, TypeError for a `"private"` buffer.
     */
    write(data: BufferSource, offset?: number): void;
    /**
     * Copy bytes out of the buffer, first waiting for any committed frame
     * that used the buffer to finish, so GPU writes from those frames are
     * visible. Work that was encoded but not committed is not waited for.
     * @param offset @default 0
     * @param length @default byteLength - offset
     */
    read(offset?: number, length?: number): Uint8Array;
    /**
     * Release the GPU memory now rather than when the object is collected.
     * Frames already encoded keep it alive until they finish; any later use
     * of this object throws `TypeError`.
     */
    destroy(): void;
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
    /** @default "shared" (readable from JavaScript); depth formats default to `"private"` */
    storage?: StorageMode;
    /**
     * Allocate a full mipmap chain (fill it with {@link GpuFrame.generateMipmaps}).
     * Only filterable colour formats (not `"r32uint"` or depth formats) can have their mipmaps generated.
     * @default false
     */
    mipmapped?: boolean;
    label?: string;
  }

  /**
   * A 2D texture (`MTLTexture`): a render target, something to sample, or
   * both. Create one with {@link Gpu.texture}. As with {@link GpuBuffer},
   * {@link GpuTexture.replace} and {@link GpuTexture.readPixels} wait for any
   * committed frame that used the texture.
   *
   * @category AppKit
   */
  export class GpuTexture {
    private constructor();
    readonly width: number;
    readonly height: number;
    readonly format: PixelFormat;
    /** Whether a committed frame that used the texture is still running on the GPU. */
    readonly inFlight: boolean;
    /** Whether {@link GpuTexture.destroy} has been called. */
    readonly destroyed: boolean;
    label: string;
    /**
     * Upload pixel data for the whole texture (mip level 0).
     * @param bytesPerRow distance between rows in `data`: at least one packed
     * row and a whole number of pixels. @default width × bytes per pixel
     * @throws TypeError for a `"private"` texture.
     */
    replace(data: BufferSource, bytesPerRow?: number): void;
    /**
     * Copy the texture's pixels back to JavaScript as tightly packed rows
     * (`width * height * bytesPerPixel` bytes, in the texture's own format, so
     * a `"bgra8unorm"` texture yields B, G, R, A bytes), after any committed
     * frame that used the texture has finished.
     * @throws TypeError for a `"private"` texture.
     */
    readPixels(): Uint8Array;
    /** Release the GPU memory now; see {@link GpuBuffer.destroy}. */
    destroy(): void;
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
    /** Which stage the function was written for; `null` for kinds this API does not use. */
    readonly type: "vertex" | "fragment" | "kernel" | null;
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

  /** One `[[attribute(index)]]` input the vertex function reads via `[[stage_in]]`. */
  export interface VertexAttribute {
    format: VertexFormat;
    /** Byte offset of the attribute inside one vertex (or instance). @default 0 */
    offset?: number;
    /**
     * The `n` of `[[attribute(n)]]`. Each index may be described once.
     * @default one more than the previous attribute's, counting across buffers from 0
     */
    index?: number;
  }

  /**
   * How one vertex buffer is laid out, for pipelines whose vertex function
   * takes a `[[stage_in]]` argument. Pipelines that index buffers by
   * `[[vertex_id]]` themselves do not need one.
   *
   * @example
   * ```ts
   * // position: float2 at [[attribute(0)]], color: uchar4norm at [[attribute(1)]], 12 bytes per vertex
   * const layout: VertexBufferLayout = { stride: 12, attributes: [{ format: "float2" }, { format: "uchar4norm", offset: 8 }] };
   * ```
   */
  export interface VertexBufferLayout {
    /** Bytes from one vertex (or instance) to the next; a multiple of 4. */
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
    /**
     * Set when the render pass has a depth attachment: an offscreen pass with
     * a `depth` texture, or a view pass with the same `depthFormat`.
     * @default undefined
     */
    depthFormat?: "depth32float" | "depth32float-stencil8";
    /**
     * Vertex buffer layout for a `[[stage_in]]` vertex function: one entry
     * for vertex buffer 0, or an array whose element `i` describes the buffer
     * bound with {@link GpuFrame.vertexBuffer vertexBuffer(i, …)}.
     */
    vertexLayout?: VertexBufferLayout | readonly VertexBufferLayout[];
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
    /** A `"depth32float"` or `"depth32float-stencil8"` texture, the same size as `color`, to use as the depth attachment. */
    depth?: GpuTexture;
    /** Value the depth attachment is cleared to first, or `false` to keep its contents. @default 1 */
    clearDepth?: number | false;
  }

  /** Options for a {@link GpuFrame.renderPass} into a {@link MetalView}. */
  export interface ViewPassOptions {
    /**
     * Clear the drawable to this colour first, or `false` to keep what is
     * there. Left out, the first pass into the view in a frame clears to the
     * view's {@link MetalViewProps.clearColor clearColor} and later passes in
     * the same frame keep what the earlier ones drew.
     */
    clear?: ClearColor | false;
    /**
     * Give the pass a depth attachment: the view keeps a depth texture of
     * this format, sized to the drawable, from the first pass that asks for
     * one (changing the format reallocates it). Passes that leave this out
     * have no depth attachment. Pipelines used in the pass need the same
     * {@link GpuRenderPipelineOptions.depthFormat depthFormat}.
     */
    depthFormat?: "depth32float" | "depth32float-stencil8";
    /**
     * Value the depth attachment is cleared to first, or `false` to keep its
     * contents. Left out, it is cleared to 1 on the first pass into the view
     * in a frame and kept after that.
     */
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
    /**
     * Which kind of pass, if any, the encoder methods currently apply to;
     * `"dropped"` for a {@link MetalView.onFrame} frame whose handler threw
     * before committing it.
     */
    readonly state: "open" | "in a render pass" | "in a compute pass" | "in a blit pass" | "committed" | "dropped";
    /**
     * How far the GPU has got with the frame, without blocking:
     * `"notCommitted"`, then `"running"` after {@link GpuFrame.commit}, then
     * `"completed"` or `"failed"` (see {@link GpuFrame.error}).
     */
    readonly gpuStatus: "notCommitted" | "running" | "completed" | "failed";
    /** What the GPU reported once {@link GpuFrame.gpuStatus} is `"failed"`; `null` otherwise. */
    readonly error: GpuExecutionError | null;
    label: string;

    /**
     * Start a render pass into a {@link MetalView}'s current drawable, which
     * is presented on commit. Only valid from inside that view's
     * {@link MetalView.onFrame onFrame} handler (call {@link MetalView.draw}
     * to run one on demand).
     * @throws TypeError outside the view's `onFrame`, or if the view has no drawable (no GPU, or no size yet).
     */
    renderPass(target: MetalView, options?: ViewPassOptions): this;
    /** Start a render pass into offscreen texture(s). */
    renderPass(target: RenderPassTarget): this;
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
    /** Bind `buffer` from byte `offset` (a multiple of 4 inside the buffer). @param offset @default 0 */
    vertexBuffer(index: number, buffer: GpuBuffer, offset?: number): this;
    /** Bind up to 4 KB of data copied from `data` (uniforms) without a `GpuBuffer`. */
    vertexBytes(index: number, data: BufferSource): this;
    vertexTexture(index: number, texture: GpuTexture): this;
    /** @param offset a multiple of 4 inside the buffer. @default 0 */
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
    /**
     * Set the depth test for the pass.
     * @throws TypeError if the pass has no depth attachment ({@link RenderPassTarget.depth} / {@link ViewPassOptions.depthFormat}).
     */
    depthStencil(state: GpuDepthStencil): this;
    /**
     * Draw `vertexCount` vertices with the current pipeline and bindings.
     * @throws TypeError if no render pipeline is set.
     */
    draw(vertexCount: number, options?: DrawOptions): this;
    /** Draw `indexCount` indices taken from `indexBuffer`. */
    drawIndexed(indexCount: number, indexBuffer: GpuBuffer, options?: DrawIndexedOptions): this;

    // Compute pass bindings.
    /** @param offset a multiple of 4 inside the buffer. @default 0 */
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
     * @param threadsPerGroup threadgroup size. @default the pipeline's
     * `maxTotalThreadsPerThreadgroup` for a one-dimensional grid; for two or
     * three dimensions, `threadExecutionWidth` wide by as many rows as
     * `maxTotalThreadsPerThreadgroup` allows (depth 1), each capped at the grid's size
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
    /**
     * Fill a `mipmapped` texture's smaller levels from level 0.
     * @throws TypeError for a texture created without `mipmapped` or with a non-filterable format.
     */
    generateMipmaps(texture: GpuTexture): this;

    /**
     * Submit the work and return immediately. A pass into a {@link MetalView}
     * is presented when the GPU finishes. {@link GpuFrame.gpuStatus} and
     * {@link GpuFrame.error} tell how it went.
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
    /**
     * A new command buffer for offscreen work (rendering to textures,
     * compute, copies).
     * @throws TypeError when 32 frames are already open (created and neither
     * committed nor garbage collected); commit frames as you go.
     */
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
     * Colour the drawable is cleared to by the first
     * {@link GpuFrame.renderPass renderPass(view)} of each frame (see
     * {@link ViewPassOptions.clear}): the `MTKView`'s `clearColor`, an
     * `MTLClearColor` in sRGB, so the view's output is colour-matched like
     * every other view's colours. Reads back as the string you assigned; the
     * struct is not something the bridge hands back.
     * @default "#000000"
     */
    clearColor?: Color;
    /**
     * Target frame rate while the view is on screen and
     * {@link MetalViewProps.running running}: the `MTKView`'s
     * `preferredFramesPerSecond`, a whole number kept within 1–240. Reads the
     * view when Metal is available (so a value set through
     * {@link View.native native} shows), the assigned value otherwise.
     * @default 60
     */
    preferredFPS?: number;
    /**
     * Drive `onFrame` from the display's refresh timer: the inverse of the
     * `MTKView`'s `paused`, except that the view is also kept paused while no
     * display is attached, so with `false` (or headless) frames only happen
     * when you call {@link MetalView.draw}. Reads back as assigned, since
     * `paused` alone cannot tell the two reasons apart.
     * @default true
     */
    running?: boolean;
    /** See {@link MetalView.onFrame}. */
    onFrame?: (frame: GpuFrame, info: FrameInfo) => void;
    /** See {@link MetalView.onResize}. */
    onResize?: (size: Size) => void;
  }

  /**
   * A view you draw into with Metal: {@link View.native native} is the
   * `MTKView` (a plain `NSView` when {@link Gpu.available} is `false`), whose
   * `MTKViewDelegate` is native code that calls {@link MetalView.onFrame}
   * from `drawInMTKView:` and {@link MetalView.onResize} from
   * `mtkView:drawableSizeWillChange:`. Each frame it hands `onFrame` a
   * {@link GpuFrame}; encode a render pass into the view with
   * `frame.renderPass(view)` (add `{ depthFormat }` for a depth buffer) and
   * the result is presented when the frame commits (automatically after
   * `onFrame` returns, unless you committed it yourself). It sizes like any
   * other view: give it `width`/`height` or `grow`.
   *
   * Without a GPU the view still takes part in layout but never produces
   * frames.
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
     * Called once per frame (`MTKViewDelegate` `drawInMTKView:`, synchronously)
     * with a fresh {@link GpuFrame}. If the handler returns without
     * committing the frame it is committed for you; if it throws, the frame
     * is dropped and the error is reported. A frame the GPU later fails to
     * run is reported the same way, as a {@link GpuExecutionError}, before
     * the next call.
     */
    onFrame: ((frame: GpuFrame, info: FrameInfo) => void) | null | undefined;
    /**
     * Called with the new drawable size in pixels when the view resizes or
     * changes screen (`MTKViewDelegate` `mtkView:drawableSizeWillChange:`,
     * delivered once the call that caused the layout has returned).
     */
    onResize: ((size: Size) => void) | null | undefined;
    /**
     * Render one frame now, synchronously running `onFrame`. This is how a
     * paused view, a headless process or a test produces frames.
     */
    draw(): void;
  }
}
