/// <reference path="./objc-sdk-stubs.d.ts" />

/**
 * The Objective-C runtime from JavaScript, on macOS: every class, selector,
 * protocol, enumeration, constant and C function of Foundation, AppKit,
 * QuartzCore, Metal and MetalKit under Apple's own names, blocks made from
 * functions, classes defined in JavaScript for delegates, targets and
 * subclass overrides, and {@link ObjCApp `app`}, the `NSApplication`
 * lifecycle with the main run loop routed through Bun's event loop. The
 * frameworks are loaded with `dlopen` on first use, so programs that never
 * import this pay nothing. `bun:appkit` is a curated layer of windows,
 * stacks and controls written on it.
 *
 * It exports {@link objc} (the bridge), {@link app} (the application
 * lifecycle, also `objc.app`), and each member of `objc` by name
 * (`import { classes, defineClass } from "bun:objc"`); the default export
 * is the whole module.
 *
 * @example
 * ```ts
 * import { objc, app } from "bun:objc";
 * const { NSStatusBar, NSMenu, NSMenuItem } = objc.classes;
 *
 * app.start("accessory");
 * const item = NSStatusBar.systemStatusBar().statusItemWithLength_(-1); // ERR_INVALID_STATE without a desktop session
 * item.button().setTitle_("Hi");
 * const menu = NSMenu.new();
 * const quit = objc.target(() => app.quit());
 * const quitItem = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Quit", "action:", "q");
 * quitItem.setTarget_(quit);
 * menu.addItem_(quitItem);
 * item.setMenu_(menu);
 * const hold = app.retain(); // stay open with no window
 * ```
 *
 * Everything AppKit marks main-thread-only works on the process's main
 * JavaScript thread; Foundation and the other non-UI classes also work in a
 * `Worker` (see {@link objc}). `bun:objc` exists only on macOS; elsewhere
 * it is not a builtin and `process.getBuiltinModule("bun:objc")` returns
 * `undefined`. On macOS it throws an `Error` with
 * `code: "ERR_OBJC_UNAVAILABLE"` only when the frameworks cannot load.
 *
 * The Objective-C classes, protocols and enumerations themselves are declared
 * in a separate file generated from the macOS SDK, which is large and so not
 * loaded by default. A project opts in with
 *
 * ```ts
 * /// <reference types="bun-types/objc-sdk" />
 * ```
 *
 * in any one of its files; until then every class is an {@link ObjCClass} or
 * {@link ObjCObject} whose selectors are all `any`, and so is every name in
 * `objc.enums` and `objc.functions`.
 *
 * @module bun:objc
 * @platform macOS (arm64; x64 builds but is untested)
 * @experimental
 */
declare module "bun:objc" {
  global {
    namespace NodeJS {
      interface Process {
        /** The module on macOS; `undefined` elsewhere, where it is not a builtin. */
        getBuiltinModule(id: "bun:objc"): typeof import("bun:objc") | undefined;
      }
    }
  }

  /**
   * The application's presence on screen (`NSApplicationActivationPolicy`).
   *
   * - `"regular"`: a normal app with a Dock icon and a menu bar.
   * - `"accessory"`: no Dock icon and no menu bar, but can show windows and be
   *   activated. Good for utilities and tests.
   * - `"background"`: no user interface at all
   *   (`NSApplicationActivationPolicyProhibited`, which is also what a
   *   process that never set a policy reads as).
   */
  export type ActivationPolicy = "regular" | "accessory" | "background";

  /** Passed to `"beforequit"` and `"willquit"` listeners. */
  export interface QuitEvent {
    /** Keep the app running: the quit is abandoned (in `"beforequit"`, before any window was touched). */
    preventDefault(): void;
    /** Whether a listener that ran earlier in this round already called {@link preventDefault}. */
    readonly defaultPrevented: boolean;
  }

  /**
   * A selector made with {@link ObjC.sel `objc.sel()`}, for arguments whose
   * Objective-C type is `SEL`. A plain string is accepted there too.
   */
  export interface ObjCSelector {
    /** The selector as Objective-C spells it, e.g. `"setFrame:display:"`. */
    readonly name: string;
    toString(): string;
  }

  /**
   * Storage for an out-parameter: an argument whose Objective-C type is a
   * pointer to one value (`NSError **`, `BOOL *`, `double *`,
   * `NSRangePointer`). {@link ObjC.out `objc.out()`} makes one; a plain `{}`
   * works too (such a parameter is typed `Partial<ObjCOut<T>>`). A
   * parameter that is a C array or buffer the method indexes
   * (`unichar *buffer` with a `range:`, `id objects[]` with a `count:`,
   * `char *`, `const CGFloat *`) is not this: it takes an `ArrayBuffer` or
   * typed array lent for the call (its byte length checked against the
   * method's `count:`, `length:` or `range:` argument when it has one;
   * not a `SharedArrayBuffer` or a resizable `ArrayBuffer`), or `null`. A
   * `BOOL *` is this on both architectures (on x86_64 the runtime encodes
   * one like a `char *`; the SDK tables say which parameters those are).
   *
   * Passing one where a method takes such a pointer hands the method storage
   * holding `value` (zero / `nil` when unset); after the call `value` is what
   * the method left there (`null` for `nil`). Passing `null` instead, or
   * leaving off out-parameters at the end of the argument list, passes
   * `NULL`. The other way round, a block or a {@link ObjC.defineClass defined}
   * method receives one for each pointer argument it is called with: `value`
   * is what the caller's storage holds for numbers, booleans and structs (an
   * enumeration's `stop` reads `false`), starts `null` for an out-only
   * object pointer (`NSError **`) and holds the caller's object for one
   * declared `inout` (`N^@`, KVC validation), and what the function leaves
   * in `value` is stored back when it returns (converted like any argument
   * of the pointed-to type).
   *
   * @example
   * ```ts
   * const error = objc.out<ObjCObject | null>();
   * const attrs = NSFileManager.defaultManager().attributesOfItemAtPath_error_(path, error);
   * if (attrs === null) console.error(`${error.value!.localizedDescription()}`);
   * ```
   */
  export interface ObjCOut<T = any> {
    value: T;
  }

  /**
   * The members of one `NS_ENUM` / `NS_OPTIONS` type from
   * {@link ObjC.enums `objc.enums`}, under both their short name (Apple's
   * member name less the prefix it shares with the type, first word in lower
   * case: `titled`, `byWordWrapping`, `png`) and their full name
   * (`NSWindowStyleMaskTitled`). Frozen; `Object.keys()` lists both
   * spellings. `Short` names the members; `Big` those whose value is above
   * 2^53 and so a `bigint` (`NSEventMask.any`).
   */
  export type ObjCEnum<Short extends string = never, Big extends string = never> = {
    readonly [K in Short]: number;
  } & { readonly [K in Big]: bigint } & { readonly [member: string]: number };

  /**
   * The `Error` a message sent through {@link objc} throws when the method
   * raises an Objective-C exception (`[array objectAtIndex:99]`,
   * `[dict setObject:nil forKey:k]`). The process carries on; whatever the
   * method had done before raising stays done.
   */
  export interface ObjCException extends Error {
    readonly code: "ERR_OBJC_EXCEPTION";
    /** The `NSException` name, e.g. `"NSRangeException"` (the class name for anything else thrown, or for an exception made without a name). */
    name: string;
    /** The `NSException` reason, `""` when it has none (`-description` for anything else thrown). */
    message: string;
    /** `-[NSException userInfo]` printed with `-description`, when there is one. */
    readonly userInfo?: string;
    /** The thrown object itself, usually an `NSException`; absent only when `nil` was thrown. */
    readonly exception?: ObjCObject;
  }

  /**
   * One instance method of a class made with {@link ObjC.defineClass}: the
   * function alone, or the function with the method's Objective-C type
   * encoding when nothing else declares it; or, for a method that answers
   * the same every time (`isFlipped`, `acceptsFirstResponder`), that answer.
   *
   * The function runs on the thread that defined the class, synchronously,
   * inside whatever sent the message (AppKit dispatching an event, or your
   * own bridged call), with the receiving object's handle as `this` (the
   * class's for a class method) and the arguments converted the way message
   * results are (objects as {@link ObjCObject}, never unboxed). What it
   * returns is converted the way message arguments are for the method's
   * return type. If it throws, or returns something that does not fit, that
   * is reported as an uncaught JavaScript error and the sender gets `0` /
   * `NO` / `nil`. `this.super` (or {@link ObjC.super `objc.super(this)`})
   * sends to the superclass's implementation from inside it.
   *
   * A constant (`isFlipped: true`, `tag: 7`, `menu: null`) becomes a native
   * method that returns it without calling into JavaScript, so it costs
   * nothing and answers on any thread. It must fit the return type: a
   * boolean for `BOOL`, a number for the numeric types, `null` for an
   * object, class, selector or pointer.
   */
  export type ObjCMethod<This = ObjCObject> =
    | ((this: This, ...args: any[]) => unknown)
    | ObjCConstant
    | {
        /**
         * The method's type encoding, return type first, then `@:` for the
         * receiver and selector, then one code per argument:
         * `"v@:@"` (void, one object), `"B@:"` (BOOL, none; `B` on both
         * architectures), `"q@:@q"` (NSInteger; object, NSInteger),
         * `"{CGSize=dd}@:@"` (a struct).
         * Needed when no adopted protocol and no superclass declares the
         * selector; without it such a method is a `TypeError` at definition.
         * When one does, this must pass arguments the same way it declares
         * (else a `TypeError` naming both encodings).
         */
        types?: string;
        fn: (this: This, ...args: any[]) => unknown;
      }
    | { types?: string; value: ObjCConstant };

  /** What a defined method can return without a function: see {@link ObjCMethod}. */
  export type ObjCConstant = boolean | number | bigint | null;

  /** What {@link ObjC.defineClass} takes. */
  export interface ObjCClassDefinition {
    /**
     * The Objective-C class name (letters, digits, `_`); omitted, one is
     * generated. On the main thread the class is registered under this name,
     * which must not be taken, and is then also `objc.classes[name]`; on any
     * other thread it is registered as `name_<n>` (`n` numbering the threads
     * that use the bridge), so the plain name is always the main thread's
     * and `String(cls)` says which a `Worker` got. Defining, on the same
     * thread, a class this thread already defined from an identical
     * definition (same name, superclass, protocols, selectors, types and
     * constants: the same module evaluated again, as each file under
     * `bun test --isolate` does) returns that class with its methods now
     * calling the new functions; any other reuse of a name is a `TypeError`.
     */
    name?: string;
    /**
     * The class to extend, by name or handle. Default `NSObject`. A class
     * another thread defined with `defineClass` cannot be extended, nor, off
     * the main thread, one AppKit keeps to the main thread.
     */
    superclass?: string | ObjCClass | ObjCObject;
    /**
     * Protocols the class adopts, by name (`"NSTableViewDataSource"`,
     * `"NSWindowDelegate"`). `conformsToProtocol:` then answers for them,
     * and their method declarations type the methods below, optional ones
     * included. Every method a protocol marks required must be defined or
     * inherited. Any protocol the Foundation, AppKit, QuartzCore, Metal and
     * MetalKit headers declare works, registered at run time or not; another
     * framework's must be registered by it. An unknown name is a `TypeError`.
     */
    protocols?: string[];
    /**
     * Instance methods keyed by selector, with colons
     * (`"tableView:objectValueForTableColumn:row:"`, `"isFlipped"`) or with
     * underscores the way sends spell them
     * (`tableView_objectValueForTableColumn_row_`), never with a `-` or `+`
     * in front. Each overrides any superclass implementation, which it can
     * still call through `this.super`. An `init…` method receives the object
     * `alloc` made as `this`: hand it to the superclass's initializer
     * (`const self = this.super.initWithFrame_(frame)`) or on to another of
     * the class's own (`return this.initWithFrame_(frame)`), set the result
     * up and return it (or `null`), as Objective-C does; `this` is consumed
     * by that call like any receiver of an `init…`. An ownership the SDK
     * headers declare for the selector (`unarchiver:didDecodeObject:` owns
     * its object and returns a retained one; `awakeAfterUsingCoder:` owns
     * `this` like an `init…`) holds for your implementation too, with
     * nothing to do beyond returning the object meant. The
     * reference-counting methods, `dealloc`, `forwardInvocation:` and
     * `methodSignatureForSelector:` cannot be defined.
     */
    methods: { [selector: string]: ObjCMethod };
    /**
     * Class methods (`+sharedThing`, `+layerClass`), keyed the same way, with
     * the class handle as `this`. Typed by `types`, else by the superclass's
     * class method of that name; with neither, a `TypeError`. `alloc` and
     * `allocWithZone:` cannot be defined.
     */
    classMethods?: { [selector: string]: ObjCMethod<ObjCClass> };
  }

  /**
   * What `this.super` and {@link ObjC.super `objc.super(object)`} give: the
   * object's methods as the superclass of the defining class implements
   * them, spelled like {@link ObjCObject}'s (`this.super.drawRect_(rect)`,
   * `this.super.msgSend("initWithFrame:", frame)`).
   */
  export interface ObjCSuper {
    msgSend(selector: string, ...args: unknown[]): unknown;
    readonly [selector: string]: any;
  }

  /**
   * A handle on an Objective-C object (an `id`), from {@link objc} or from a
   * `bun:appkit` `Window.native`/`View.native`. It holds one reference to
   * the object until it is garbage collected (or {@link ObjCObject.release released}),
   * and the collector is told how much an `NSData`, `NSString` or bitmap
   * weighs. One object has one handle for as long as the handle is
   * reachable, so `===` compares objects; a class always comes back as its
   * {@link ObjCClass}.
   *
   * Every property is a method that sends the selector of the same name,
   * spelled PyObjC style: each `_` stands for a `:` and the call takes
   * exactly that many arguments (`setFrame_display_(rect, true)` sends
   * `setFrame:display:`; `length()` sends `length`). Leading underscores are
   * kept as they are and `__` inside a name is a literal `_`. Reading the
   * property does not send anything; calling it does. A selector no
   * property spells (an `_` right before a trailing `:` or at its end, or
   * `::` away from the end) takes `msgSend("sel:")`.
   *
   * Arguments and results are converted by the method's Objective-C
   * signature: see the table in the `bun:objc` documentation.
   * Object results come back as `ObjCObject` (or `null` for `nil`), never
   * unboxed; use `${object}`, {@link ObjC.js `objc.js()`} or the object's
   * own methods (`UTF8String()`, `intValue()`) to get JavaScript values.
   *
   * `"count" in handle` tells whether the object responds to that selector,
   * `Object.keys(handle)` lists the selectors its classes implement (spelled
   * as properties), `console.log(handle)` prints `[objc ClassName: description]`,
   * `using` releases the handle at the end of the block, and the Foundation
   * collections are iterable: an `NSArray`, `NSSet` or `NSOrderedSet` yields
   * its objects, an `NSDictionary` its keys, an `NSIndexSet` its indexes, an
   * `NSEnumerator` what it has left.
   *
   * @example
   * ```ts
   * const { NSMutableArray } = objc.classes;
   * const list = NSMutableArray.new();
   * list.addObject_("one");          // strings box to NSString
   * list.count();                    // 1
   * `${list.objectAtIndex_(0)}`;     // "one"
   * for (const item of list) console.log(objc.js(item));
   * ```
   */
  export interface ObjCObject {
    /**
     * Send `selector`, spelled the Objective-C way (`"setFrame:display:"`),
     * with `args`; the escape hatch for names the property spelling cannot
     * express.
     * @throws TypeError if the object does not respond to `selector`, or the
     * arguments do not fit its signature.
     */
    msgSend(selector: string, ...args: unknown[]): unknown;
    /** `-description` as a JavaScript string; also what `${object}` and `String(object)` give. */
    toString(): string;
    /** What {@link ObjC.js `objc.js()`} gives for the object, or its `-description` when that is still an object. */
    toJSON(): unknown;
    /**
     * End this handle: its one reference to the object goes now instead of
     * when the handle is garbage collected, and every later use of it throws
     * `ERR_INVALID_STATE`. One object has one handle, so that holds for
     * every variable and earlier result that refers to the same object; a
     * message that returns the object afterwards mints a fresh handle.
     * Calling it again does nothing. Use it to let go of something large
     * your code created (an `NSData`, a bitmap) as soon as you are done
     * rather than when the collector gets to it; everything else can simply
     * be dropped. Releasing ends the object's one handle program-wide, and
     * that includes `bun:appkit`'s own use of it when a window or view holds
     * the object (its `.native`, its delegate, its constraints, a menu's
     * items): a delegate released this way stops delivering events. A block
     * from {@link ObjC.block `objc.block()`} or an object from
     * {@link ObjC.target `objc.target()`} keeps its function for as long as
     * native code still holds the object, released or not. The
     * `retain`/`release`/`autorelease` selectors themselves are refused:
     * reference counting is the handle's job.
     */
    release(): void;
    /** {@link ObjCObject.release release()}, for `using data = …`: the handle ends when the block does. */
    [Symbol.dispose](): void;
    /**
     * On a block object: call it with `args`, converted by the type
     * signature the block was compiled with (a block from
     * {@link ObjC.block `objc.block()`} or one a framework handed over, such
     * as a completion handler a defined method receives). On any other
     * object this is the `invoke` selector (`NSInvocation` has one).
     * @throws TypeError if the block records no signature, or the arguments do not fit it.
     */
    invoke(...args: unknown[]): any;
    /**
     * Inside a method of a class from {@link ObjC.defineClass}: this object's
     * methods as the superclass of the class that defines the running method
     * implements them (`[super …]`). Bound to that class when read, so what
     * the read gives keeps sending there after an `await`, from a timer, or
     * from a closure run under a subclass's method. Read where no method of
     * the object is running (after an `await`, in a callback) there is no
     * class to bind to: read it first, or use
     * {@link ObjC.super `objc.super(object, cls)`} to name the class.
     * @throws TypeError when read outside such a method.
     */
    readonly super: ObjCSuper;
    /**
     * The elements of an `NSArray`, `NSSet`, `NSOrderedSet` or `NSHashTable`,
     * the keys of an `NSDictionary` or `NSMapTable`, the indexes of an
     * `NSIndexSet`, or what an `NSEnumerator` has left, as handles (numbers
     * for indexes); the generated declarations for those classes say which
     * (`objc.NSArray` yields `ObjCObject`, `objc.NSIndexSet` `number`). Reads
     * as `undefined` on any other object, which is therefore not iterable;
     * on an untyped handle the element type is `any`.
     */
    [Symbol.iterator](): IterableIterator<any>;
    /** The object's address. */
    readonly [objc.pointer]: bigint;
    /**
     * `object.someSelector_with_(a, b)` sends `someSelector:with:`. Every
     * such property is a function; it is typed `any` so that calls type-check
     * under `noUncheckedIndexedAccess`.
     */
    readonly [selector: string]: any;
  }

  /**
   * A handle on an Objective-C class, from {@link ObjC.classes `objc.classes`}.
   * Properties are class methods, spelled like {@link ObjCObject}'s.
   *
   * @example
   * ```ts
   * const { NSString } = objc.classes;
   * const s = NSString.stringWithString_("hi");
   * const owned = NSString.alloc().initWithUTF8String_("hi"); // alloc/init ownership is handled
   * ```
   */
  export interface ObjCClass {
    /** See {@link ObjCObject.msgSend}. */
    msgSend(selector: string, ...args: unknown[]): unknown;
    /** The class name. */
    toString(): string;
    toJSON(): unknown;
    /**
     * `+alloc`. The only thing to do with the result is send it an `init…`;
     * the allocation itself waits until then (or, for a class cluster whose
     * instances alone know their `init…` methods, until the first `init…` is
     * looked up), so an `init…` that throws leaves nothing initialised
     * behind. Anything else on the result throws a `TypeError` until an
     * `init…` has succeeded.
     */
    readonly alloc: () => ObjCObject;
    // A property, because `new(): T` in an interface would be a construct signature.
    readonly new: () => ObjCObject;
    /** Inside a class method of a class from {@link ObjC.defineClass}: the superclass's class methods. See {@link ObjCObject.super}. */
    readonly super: ObjCSuper;
    readonly [objc.pointer]: bigint;
    readonly [selector: string]: any;
  }

  /**
   * Types for what the {@link objc} bridge hands out, under the names
   * Objective-C uses: `objc.NSWindow` is a handle on an `NSWindow` (an
   * {@link ObjCObject} with that class's instance methods and its
   * superclasses' spelled out), `objc.classes.NSWindow` the type of the
   * class object `objc.classes.NSWindow` (its class methods),
   * `objc.protocols.NSTableViewDelegate` an object conforming to that
   * protocol (its `@optional` methods declared optional: test
   * `"tableView_viewForTableColumn_row_" in delegate` before calling one),
   * `objc.NSWindowStyleMask` a member of that enumeration (a number, or
   * `number | bigint` for the few with a member above 2^53), and
   * `objc.CGRect` and the rest below the structs that cross as objects. The
   * classes, protocols and enumerations are generated from the macOS SDK
   * into bun-types/objc-sdk.d.ts, for the classes `bun:appkit` builds on
   * and the common Foundation and AppKit ones, and are declared once a file
   * says `/// <reference types="bun-types/objc-sdk" />`; before that the
   * classes here are empty (every selector `any`) and the protocols and
   * enumerations absent. Any other class is a plain {@link ObjCObject}, any
   * other selector on these is still `any`.
   */
  export namespace objc {
    /**
     * What {@link ObjC.enums `objc.enums`} holds by name: empty until
     * bun-types/objc-sdk.d.ts is referenced, which lists each
     * enumeration with its members and each constant with its type.
     */
    interface Enums {}
    /**
     * What {@link ObjC.functions `objc.functions`} holds by name: empty
     * until bun-types/objc-sdk.d.ts is referenced, which types each
     * function's arguments and result.
     */
    interface Functions {}

    /**
     * What a parameter of type `id` accepts: a handle, or a JavaScript value
     * the bridge boxes the way {@link ObjC.ns `objc.ns()`} does.
     */
    type Id =
      | ObjCObject
      | ObjCClass
      | string
      | number
      | boolean
      | bigint
      | Date
      | ArrayBufferView
      | ArrayBufferLike
      | readonly unknown[]
      | { readonly [key: string]: unknown };
    /** `CGPoint` / `NSPoint`. */
    interface CGPoint {
      x: number;
      y: number;
    }
    /** `CGSize` / `NSSize`. */
    interface CGSize {
      width: number;
      height: number;
    }
    /** `CGRect` / `NSRect`. A parameter also takes the flat {@link Rect}. */
    interface CGRect {
      origin: CGPoint;
      size: CGSize;
    }
    /** A rectangle spelled flat, which a `CGRect` parameter accepts too (`bun:appkit`'s `Rect`). */
    interface Rect {
      x: number;
      y: number;
      width: number;
      height: number;
    }
    interface CGVector {
      dx: number;
      dy: number;
    }
    /**
     * `NSRange`. Both members are `NSUInteger`s, so a value above 2^53 is a
     * `bigint`: `location` is {@link ObjC.NSNotFound `objc.NSNotFound`} in a
     * range that reports no match, `length` can be `NSUIntegerMax`.
     */
    interface NSRange {
      location: number | bigint;
      length: number | bigint;
    }
    interface NSEdgeInsets {
      top: number;
      left: number;
      bottom: number;
      right: number;
    }
    interface NSDirectionalEdgeInsets {
      top: number;
      leading: number;
      bottom: number;
      trailing: number;
    }
    interface CGAffineTransform {
      a: number;
      b: number;
      c: number;
      d: number;
      tx: number;
      ty: number;
    }
    interface CATransform3D {
      m11: number;
      m12: number;
      m13: number;
      m14: number;
      m21: number;
      m22: number;
      m23: number;
      m24: number;
      m31: number;
      m32: number;
      m33: number;
      m34: number;
      m41: number;
      m42: number;
      m43: number;
      m44: number;
    }
  }

  /**
   * A keep-alive token from {@link ObjCApp.retain `objc.app.retain()`}: the
   * process stays open (and out of App Nap) until every outstanding token is
   * released. Releasing twice is harmless; `using` releases at scope exit.
   */
  export interface ObjCAppHold extends Disposable {
    release(): void;
    readonly released: boolean;
  }

  /** The events {@link ObjCApp.on `objc.app.on()`} accepts: the quit sequence and the Dock click. */
  export interface ObjCAppEventMap {
    /**
     * Something asked the app to quit: {@link ObjCApp.quit `app.quit()`},
     * the Quit menu item / Cmd+Q, the Dock menu, or AppleScript. The first
     * of two rounds: every listener runs and may call
     * `event.preventDefault()` (or return `false`) to keep the app running;
     * none may act on the quit yet, since a later listener can still cancel
     * it. `bun:appkit`'s `app.on("beforequit")` listeners run in this round.
     */
    beforequit: [event: QuitEvent];
    /**
     * The second round, only when no `"beforequit"` listener cancelled: the
     * quit is going ahead, so this is where to act on it (`bun:appkit`
     * asks every open `Window`'s `shouldClose` and closes it here). A
     * listener may still cancel; what earlier listeners of this round did
     * is not undone. When none cancels the process exits.
     */
    willquit: [event: QuitEvent];
    /**
     * The running app was opened again (its Dock icon clicked, or
     * double-clicked in Finder). `hasVisibleWindows` says whether any window
     * (including miniaturized ones) is still around.
     */
    reopen: [hasVisibleWindows: boolean];
  }

  /**
   * The `NSApplication` lifecycle `bun:appkit`'s curated `app` is written
   * on: starting AppKit on the main thread, the application delegate, the
   * quit sequence, activation, the Dock badge and what keeps the process
   * open. Everything here is a message to `NSApplication` over the bridge but
   * for start-up and the keep-alive; use it when you build on `objc` alone,
   * or to reach what `app` does not surface (the delegate). Reading never
   * starts the application.
   *
   * The delegate is `BunApplicationDelegate`, a class defined in JavaScript
   * with {@link ObjC.defineClass}: it answers `applicationShouldTerminate:`
   * (the {@link ObjCAppEventMap.beforequit `"beforequit"`} and `"willquit"`
   * listeners), `applicationWillTerminate:` (runs the process's exit
   * handlers before AppKit ends it), `applicationShouldHandleReopen:hasVisibleWindows:`
   * (`"reopen"`) and `applicationSupportsSecureRestorableState:` (YES),
   * and nothing else; start-up completes through
   * `NSApplicationDidFinishLaunchingNotification`, not the delegate.
   * Extend it through {@link ObjCApp.delegate}.
   */
  export interface ObjCApp {
    /**
     * Starts AppKit on this thread if it has not: `NSApplication` with the
     * current {@link ObjCApp.activationPolicy} (or `policy`), the delegate,
     * and the main run loop routed through Bun's event loop so timers,
     * blocks and notifications Foundation delivers "later" arrive. Does not
     * activate the app or show anything. Idempotent. The curated layer calls
     * it when the first `Window` is made.
     * @throws Error with `code: "ERR_OBJC_WRONG_THREAD"` off the main thread; with `code: "ERR_OBJC_UNAVAILABLE"` where the system frameworks cannot load.
     */
    start(policy?: ActivationPolicy): void;
    /** Whether {@link ObjCApp.start} has run on this thread. */
    readonly isRunning: boolean;
    /**
     * `-[NSApplication activationPolicy]`. Before the start it is what the
     * start will use; after, reading asks AppKit (so a `setActivationPolicy:`
     * sent directly shows here) and assigning changes it live; assigning
     * what AppKit already has does nothing.
     * @default "regular"
     * @throws TypeError for a name that is not one; Error with `code: "ERR_INVALID_STATE"` when AppKit refuses the change.
     */
    activationPolicy: ActivationPolicy;
    /** `-[NSDockTile setBadgeLabel:]`: text on the Dock tile, `null` for none; kept for the start if set before. */
    get badge(): string | null;
    set badge(value: string | number | null);
    /** Whether `-[NSApplication effectiveAppearance]` is a dark one; `false` before the start. */
    readonly isDark: boolean;
    /**
     * Whether any `NSScreen` is attached; loads AppKit, does not start it.
     * Without one (plain `ssh`, CI) windows and views still work off screen,
     * and `-[NSStatusBar statusItemWithLength:]`, which would make AppKit
     * exit the process with status 0 and no error, throws `ERR_INVALID_STATE`.
     */
    readonly hasDisplay: boolean;
    /**
     * `-[NSApplication delegate]`. `null` (the default) installs an
     * instance of `BunApplicationDelegate` and reads back as that instance
     * once the app has started. To receive delegate messages
     * (`application:openURLs:`, `applicationDidBecomeActive:`, …) define a
     * subclass, `objc.defineClass({ superclass: "BunApplicationDelegate",
     * methods: { … } })`, and set an instance: it is installed as the
     * delegate itself. An override of one of the four methods the class
     * implements calls `this.super` for the built-in part: an
     * `applicationShouldTerminate:` that defers (`NSTerminateLater`) calls
     * up first and returns its own answer unless that was
     * `NSTerminateCancel`; an `applicationWillTerminate:` calls up last,
     * since that is where the process's `exit` handlers run. Set before the
     * start, the instance is what the start installs.
     *
     * Keep your object referenced; AppKit holds delegates weakly.
     * @throws TypeError for anything but an instance of `BunApplicationDelegate` (or a subclass) or `null`.
     */
    get delegate(): ObjCObject | null;
    set delegate(value: ObjCObject | null);
    /** Starts the app if needed and `-[NSApplication activateIgnoringOtherApps:]`: brings it to the front. */
    activate(): void;
    /** `-[NSApplication hide:]`; nothing before the start. */
    hide(): void;
    /**
     * Asks to quit the way Cmd-Q, the Quit menu item, the Dock and a logout
     * do: every {@link ObjCAppEventMap.beforequit `"beforequit"`} listener
     * may cancel, then every {@link ObjCAppEventMap.willquit `"willquit"`}
     * listener may act and still cancel; if none does the process exits at
     * the next event-loop turn through `process.exit(process.exitCode)`,
     * whatever holds it open. Before the start this is `process.exit()` at
     * once. A quit already accepted is not asked about again.
     */
    quit(): void;
    /**
     * Holds the process open (and, once the app has started, App Nap off)
     * until the token is released: for a menu-bar tool or a script waiting
     * on Foundation callbacks with no window. Does not start the app, and
     * holds whether or not it has started. The curated `app.keepAlive` and
     * every open `Window` hold one of these. In a `Worker` it holds the
     * Worker open instead. A block or defined method another thread will
     * call later (a completion handler, an operation's block) keeps nothing
     * alive by itself: hold a token until that call has run.
     */
    retain(): ObjCAppHold;
    /**
     * Listeners run in registration order; one that throws is reported as
     * an uncaught error and neither stops the rest nor changes the verdict.
     * `bun:appkit` registers a `"beforequit"` listener that asks its own
     * `app.on("beforequit")` listeners, and a `"willquit"` listener that
     * asks every open `Window`'s `shouldClose` and closes it.
     * @throws TypeError for an event name not in {@link ObjCAppEventMap}.
     */
    on<K extends keyof ObjCAppEventMap>(event: K, listener: (...args: ObjCAppEventMap[K]) => void): this;
    off<K extends keyof ObjCAppEventMap>(event: K, listener: (...args: ObjCAppEventMap[K]) => void): this;
  }

  export interface ObjC {
    /** The `NSApplication` lifecycle: see {@link ObjCApp}. `app` in `bun:appkit` is built on it. Also exported on its own as `app`. */
    readonly app: ObjCApp;
    /**
     * Any Objective-C class the loaded frameworks (Foundation, AppKit,
     * QuartzCore, Metal, MetalKit) register, by name. The ones `bun:appkit` builds on
     * and the common Foundation and AppKit classes ({@link ObjCKnownClasses})
     * have types of their own (`objc.classes.NSWindow` is an
     * {@link objc.classes.NSWindow}, what it makes an {@link objc.NSWindow}),
     * whose methods are declared once bun-types/objc-sdk.d.ts is
     * referenced and are all `any` before; every other name is a plain
     * {@link ObjCClass}, which under
     * `noUncheckedIndexedAccess` reads as possibly `undefined` to TypeScript;
     * at run time it is a class or a `TypeError`, never `undefined`, so
     * `objc.classes.NSRareThing!` is safe.
     * @throws TypeError for a name that is not a registered class.
     */
    readonly classes: { readonly [name: string]: ObjCClass } & ObjCKnownClasses;
    /**
     * Any protocol Foundation, AppKit, QuartzCore, Metal and MetalKit declare
     * or another loaded framework registers, by name, as the `Protocol`
     * object `conformsToProtocol:` and the like take. Same
     * `noUncheckedIndexedAccess` caveat as {@link ObjC.classes}.
     * @throws TypeError for a name that is neither.
     */
    readonly protocols: { readonly [name: string]: ObjCObject };
    /**
     * The constants the loaded frameworks export as globals, by name:
     * `NSString` keys and names (`NSFontAttributeName`,
     * `NSWindowDidResizeNotification`, `NSDefaultRunLoopMode`) come back as
     * handles, and the numbers and structs Foundation and AppKit declare
     * (`NSFontWeightBold`, `NSViewNoIntrinsicMetric`, `NSZeroRect`, and the
     * CoreFoundation and C numbers their headers pull in) as numbers and
     * objects. Anything else is read as an object, after a check that the
     * global holds one; use {@link ObjC.constant} to give another type.
     * Same `noUncheckedIndexedAccess` caveat as {@link ObjC.classes}.
     * @throws TypeError for a name no loaded framework exports, the name of
     * a function, or a global outside the table that does not hold an object.
     */
    readonly constants: { readonly [name: string]: unknown };
    /**
     * One exported constant read as the type encoding `type` says: `"@"` (an
     * object, the default outside the built-in table), `"d"` / `"f"`
     * (`double` / `float`), `"q"` / `"Q"` (`NSInteger` / `NSUInteger`), `"B"`,
     * or a struct such as `"{CGSize=dd}"`. An `"@"` read is checked (the
     * global must hold nil or a pointer to an instance of a registered
     * class); reading a constant as any other type it does not have is
     * undefined behaviour, as in C.
     *
     * @example
     * ```ts
     * objc.constant("NSFontWeightHeavy", { type: "d" }); // 0.56
     * objc.constant("kCAGravityCenter");                 // a handle on the NSString
     * ```
     * @throws TypeError for a name no loaded framework exports, the name of
     * an exported function, or a type that is not a value type.
     */
    constant(name: string, options?: { type?: string }): unknown;
    /**
     * Every `NS_ENUM`, `NS_OPTIONS` and `NS_CLOSED_ENUM` of Foundation,
     * AppKit, QuartzCore, Metal and MetalKit by type name, as an
     * {@link ObjCEnum} of its members (`objc.enums.NSWindowStyleMask.titled`,
     * `objc.enums.NSEventType.keyDown`, `objc.enums.MTLPixelFormat.bgra8Unorm`);
     * and every member, every constant of an unnamed enum and every
     * `static const` number of those headers by its full name, as the number
     * itself (`objc.enums.NSWindowStyleMaskTitled`,
     * `objc.enums.NSUTF8StringEncoding`, `objc.enums.NSModalResponseOK`,
     * `objc.enums.NSUpArrowFunctionKey`). The few values above 2^53
     * (`NSNotFound`, `NSUIntegerMax` masks) are `bigint`s. Generated from the
     * macOS SDK, so the values are the ones the frameworks on this
     * architecture use. With bun-types/objc-sdk.d.ts referenced all of
     * those names are typed ({@link objc.Enums}), a name it lacks is a type
     * error, and only a member's full name on its enumeration
     * (`objc.enums.NSWindowStyleMask.NSWindowStyleMaskTitled`) is left to an
     * index signature; without it every name is `any`. An enumeration-typed
     * parameter in those declarations (`objc.NSWindowStyleMask`) takes these
     * numbers, and a `bigint` for the masks above 2^53.
     * @throws TypeError for a name that is neither.
     */
    readonly enums: {} extends objc.Enums ? { readonly [name: string]: any } : objc.Enums;
    /**
     * The C functions Foundation, AppKit, CoreGraphics and CoreFoundation export whose
     * argument and result types the bridge converts, by name
     * (`objc.functions.NSBeep()`, `objc.functions.NSStringFromClass(cls)`,
     * `objc.functions.NSLog("%@ and %@", a, b)`,
     * `objc.functions.CGColorCreateGenericRGB(1, 0, 0, 1)`), each a JavaScript
     * function that converts its arguments and result the way a message's
     * are (see {@link ObjC.fn}). Generated from the macOS SDK; a function
     * outside the table is reached with {@link ObjC.fn}. With
     * bun-types/objc-sdk.d.ts referenced the names are typed
     * ({@link objc.Functions}) and any other is a type error; without it
     * every name is `any`.
     * @throws TypeError for a name outside the table, or one this macOS does not export.
     */
    readonly functions: {} extends objc.Functions ? { readonly [name: string]: any } : objc.Functions;
    /**
     * The exported C function `name` as a JavaScript function, found with
     * `dlsym` in AppKit, Foundation and what they link (then anywhere in the
     * process) and called through libffi by the type encodings given:
     * `returns` is the result's (`"v"` by default), `args` one per parameter
     * (`"@"` object, `"#"` class, `":"` selector, `"B"`, `"q"`/`"Q"`/`"i"`/`"d"`/`"f"`
     * numbers, `"r*"` C string, `"^@"`/`"^q"` out-parameters, `"{CGRect={CGPoint=dd}{CGSize=dd}}"`
     * structs, `"^{CGColor=}"` CF objects), converted exactly as a message's
     * are. `format` is the index among `args` of a format string when the
     * function takes `...` after it (`NSLog`): the extra arguments are
     * objects and the format may use `%@` only. Who owns an object result
     * comes from the declaration: `returnsRetained: true` for one the header
     * marks `CF_RETURNS_RETAINED` / `NS_RETURNS_RETAINED` (the SDK table
     * says so for the functions it knows); else a CF object (`"^{CGColor=}"`)
     * from a function named `…Create…` or `…Copy…` is yours by the Create
     * Rule; any other object result is retained for the handle, as a
     * method's is. A `…Ref *` out-parameter is written `"^^{__CFError=}"`
     * (the `=` keeps the name) and gives a handle; `retainedOuts` lists the
     * out-parameters (by index among `args`) whose stored object is yours
     * where the Create Rule and a `CFErrorRef *` do not already say so.
     * Giving types the function does not have is undefined behaviour, as in C.
     *
     * @example
     * ```ts
     * const NSBeep = objc.fn("NSBeep");
     * const NSStringFromClass = objc.fn("NSStringFromClass", { returns: "@", args: ["#"] });
     * const NSLog = objc.fn("NSLog", { args: ["@"], format: 0 });
     * NSLog("%@ took %@ ms", name, elapsed);
     * ```
     * @throws TypeError for a name nothing exports (or that is a constant),
     * an encoding that does not parse, a function that retains, releases or
     * deallocates an object (`CFRelease`, `CGColorRetain`: the handles do
     * that), or when libffi is not available.
     */
    fn(
      name: string,
      types?: {
        returns?: string;
        args?: readonly string[];
        format?: number;
        returnsRetained?: boolean;
        retainedOuts?: readonly number[];
      },
    ): (...args: any[]) => any;
    /**
     * `object`'s methods as the superclass of `cls` implements them: what
     * `this.super` is inside a method of a class from
     * {@link ObjC.defineClass}, where `cls` defaults to the class that
     * defines the running method. Needs libffi (always there on macOS).
     * @throws TypeError when `cls` is omitted outside such a method, or when
     * `object` is not a `cls` (for a class object: not `cls` or a subclass).
     */
    super(object: ObjCObject | ObjCClass, cls?: ObjCClass): ObjCSuper;
    /**
     * Storage to pass for an out-parameter (`NSError **`, `BOOL *`,
     * `NSRangePointer`, …): one value, holding `value` going in; read
     * `.value` after the call. See {@link ObjCOut}.
     */
    out<T = any>(value?: T): ObjCOut<T>;
    /** A selector value for a `SEL`-typed argument (a string works there too); a `TypeError` anywhere else. */
    sel(name: string): ObjCSelector;
    /**
     * Define an Objective-C class whose methods are JavaScript functions,
     * for delegates, data sources, targets and subclass overrides (with
     * `this.super` for the superclass's implementation, `init…` overrides and
     * class methods included). Returns the class; make instances with
     * `.new()` or `.alloc().init…()` like any other. Each method is a real
     * method of the class (its IMP a libffi closure), so AppKit, key-value
     * coding and subclasses see it as one. The methods run on the thread that
     * called `defineClass` (AppKit calls them on the main thread from inside
     * event dispatch, or from inside your own call that triggered them, such
     * as `reloadData()`); a message that arrives on any other thread reads
     * as `0` / `nil` there and then, and is handed over to the defining
     * thread to run later when the method returns `void` and takes no
     * pointer or C-string arguments (its object arguments retained for the
     * trip), or else reported there as an uncaught error. A `Worker` has no
     * run loop, so there only messages sent synchronously inside the
     * Worker's own calls ever arrive on its thread. The class, its functions and what they close
     * over are registered for the whole process and never freed, once per
     * thread that runs the definition (see `name` for how a Worker's is
     * named): define classes at module scope, and not in a Worker spawned
     * per task. Once a Worker exits its classes' methods answer `0` / `nil`
     * everywhere.
     *
     * Each method's type encoding is, in order: its `types` (which must pass
     * arguments the way any declaration below does); what a listed protocol
     * declares for the selector; what the superclass implements for it; what
     * a protocol the superclass chain adopts declares for it; a selector none
     * of those declares needs `types` or its protocol listed, and is a
     * `TypeError` at definition without them (the message names the
     * registered protocols that declare it). Supported types are the ones in
     * the `objc` table except C-string and pointer returns; a block
     * argument arrives as a handle to {@link ObjCObject.invoke invoke}.
     *
     * Most AppKit setters that take one of these objects (`setDelegate:`,
     * `setDataSource:`, `setTarget:`) hold it zeroing-weak: keep your
     * handle referenced for as long as AppKit should call it, and once it
     * is gone the property reads `nil`. For the few properties still
     * declared `assign` instead (`NSXMLParser.delegate`,
     * `NSComboBox.dataSource`, `NSCache.delegate`, `NSTextFinder.client`
     * and the like) the bridge has the receiver hold what you set until you
     * set another value or `null`, so those never dangle either. Holders
     * registered by a method rather than a property are outside both rules
     * and keep a plain pointer: `NSUndoManager`'s `registerUndoWithTarget:`,
     * `addObserver:forKeyPath:` (KVO), `NSAppleEventManager` handlers. Keep
     * the handle reachable for as long as such a holder has it, and
     * unregister (`removeAllActionsWithTarget:`, `removeObserver:forKeyPath:`)
     * before letting the handle go or calling `release()`.
     *
     * @example
     * ```ts
     * const DataSource = objc.defineClass({
     *   protocols: ["NSTableViewDataSource"],
     *   methods: {
     *     "numberOfRowsInTableView:": () => rows.length,
     *     tableView_objectValueForTableColumn_row_: (_table, _column, row) => rows[row],
     *   },
     * });
     * const dataSource = DataSource.new();
     * tableView.setDataSource_(dataSource);
     *
     * const Badge = objc.defineClass({
     *   superclass: "NSView",
     *   methods: {
     *     isFlipped: true,
     *     initWithFrame_(frame) {
     *       const self = this.super.initWithFrame_(frame);
     *       self?.setWantsLayer_(true);
     *       return self;
     *     },
     *     drawRect_(dirty) {
     *       this.super.drawRect_(dirty);
     *       NSColor.systemRedColor().setFill();
     *       objc.functions.NSRectFill(this.bounds());
     *     },
     *   },
     *   classMethods: { defaultSize: { types: "{CGSize=dd}@:", fn: () => ({ width: 20, height: 20 }) } },
     * });
     * ```
     * @throws TypeError for a taken or malformed name, an unknown superclass
     * or protocol, a required protocol method left undefined, a type
     * encoding that does not parse or does not match the selector's argument
     * count, a function declaring more parameters than that, a key with a
     * `+`/`-` prefix, a reserved selector, or an unsupported type.
     */
    defineClass(definition: ObjCClassDefinition): ObjCClass;
    /**
     * An object to install as a control's or menu item's `target`, whose
     * `action:` method calls `fn` with the sender. Set the control's action
     * to `"action:"`. `NSControl` and `NSMenuItem` do not retain their
     * target: keep the returned handle referenced while it should fire. The
     * handle keeps `fn` reachable while the handle is, and while anything
     * native retains the object (a timer, an array); once neither does,
     * handle, object and `fn` are collected together, a cycle from `fn`
     * back to this handle included. Not collected: `fn` keeping reachable
     * the handle of whatever natively retains the target (the array it is
     * in, a `representedObject` pointing back), which neither collector
     * sees whole; reach that through a `WeakRef`, or clear the native
     * reference when done. Every target, on every thread, is an instance
     * of the same one class; `fn` runs only on the thread that called
     * `target()`.
     *
     * @example
     * ```ts
     * const target = objc.target(sender => console.log(`${sender} clicked`));
     * button.setTarget_(target);
     * button.setAction_("action:");
     * ```
     */
    target(fn: (this: ObjCObject, sender: ObjCObject | null) => unknown): ObjCObject;
    /**
     * An Objective-C block whose body is `fn`, to pass where a method takes
     * a block (`@?`). `types` is the block's type encoding: the return type,
     * `@?` for the block itself, then one code per argument (`"v@?"` for
     * `void (^)(void)`, `"v@?@Q^B"` for `void (^)(id, NSUInteger, BOOL *)`,
     * `"q@?@@"` for an `NSComparator`); without it the block returns `void`
     * and takes one object per parameter `fn` declares. Any encoding of the
     * types in the `objc` table works (the block's invoke function is a
     * libffi closure made once per signature), except a C-string or pointer
     * result.
     *
     * For the block parameters of Foundation, AppKit, QuartzCore, Metal and
     * MetalKit methods (`enumerateObjectsUsingBlock:`,
     * `sortedArrayUsingComparator:`, `addOperationWithBlock:`, NSTimer's
     * block timers, `beginSheetModalForWindow:completionHandler:`, ...) the
     * bridge knows the type, so a plain function can be passed directly,
     * and a block of a different type passed there is a `TypeError`. For
     * any other method `types` must match its block parameter exactly, as
     * in C: a mismatch is undefined behaviour, not an error.
     *
     * `fn` runs on the thread that made the block, inside whatever calls
     * it, with the arguments converted the way message results are; a
     * `BOOL *` argument (an enumeration's `stop`) arrives as an
     * {@link ObjCOut}. Its return value is converted for the block's return
     * type. When `fn` throws, or returns a value that does not fit, the
     * native caller gets `0` / `NO` / `nil` (and every `BOOL *` set, so an
     * enumeration ends) and, once your send that reached it returns, that
     * send throws the error (`list.sortedArrayUsingComparator_(throws)`
     * throws in JavaScript); a block AppKit calls from the event loop (a
     * timer, a completion) has no send to throw from and the error is
     * reported as uncaught instead. A call on any other thread (a
     * background queue, or the main thread for a block a `Worker` made)
     * returns zero there and then; a block that returns `void` and takes no
     * pointer or C-string arguments is handed over, its object arguments
     * retained, to the thread that made it and runs `fn` there on that
     * thread's next turn (so a completion handler called on a background
     * queue arrives), and any other is reported as an uncaught error on the
     * block's thread instead. Two consequences of the hand-over: a native
     * wait on the block's completion (`waitUntilAllOperationsAreFinished`,
     * `waitUntilFinished`, `dispatch_group_wait`) returns before `fn` has
     * run, and a wait on the block's own thread for something `fn` must do
     * (signal a condition or semaphore) never returns, because `fn` needs
     * that thread's next turn; and the hand-over holds neither the process
     * nor a `Worker` open, so a script that expects a callback from another
     * thread (a `URLSession` completion, an operation, a coordinator) holds
     * {@link ObjCApp.retain `objc.app.retain()`} until it arrives, else the
     * script ends first and the call is dropped. Handed-over calls queue
     * without bound in the order they were made, each with its retained
     * arguments, until the thread yields. A `Worker` has no run loop, so a block made
     * there runs `fn` when called synchronously inside the Worker's own
     * send (enumerations, comparators, predicates) or handed over from
     * another thread while the Worker is alive; timers scheduled from it
     * never fire. The handle keeps `fn` reachable while the handle is, and while
     * anything native retains the block (a timer, a notification centre,
     * a pending completion), until its thread exits; once neither does
     * they are collected together. The exception is `fn` keeping reachable
     * the handle of the object that retains the block
     * (`op.setCompletionBlock_(() => use(op))`): that loop spans both heaps
     * and stays until the native side lets go, so use a `WeakRef` to `op`
     * inside `fn` or clear the property afterwards. The returned handle can be passed,
     * released, sent the messages any block answers (`description`), or
     * called with {@link ObjCObject.invoke `.invoke(...args)`}.
     *
     * @example
     * ```ts
     * list.enumerateObjectsUsingBlock_((obj, index, stop) => {
     *   if (index === 2) stop.value = true;
     * });
     * const expr = NSExpression.expressionForBlock_arguments_(
     *   objc.block((object, expressions, context) => `got ${object}`, "@@?@@@"),
     *   [],
     * );
     * ```
     * @throws TypeError when `types` does not parse, does not start with
     * the return type and `@?`, or names an unsupported type.
     */
    block(fn: (...args: any[]) => unknown, types?: string): ObjCObject;
    /**
     * Convert Foundation values to JavaScript: `NSString` to string,
     * `NSNumber` to number or boolean, `NSData` to a `Uint8Array` (copied),
     * `NSDate` to a `Date`, `NSArray` to an array and `NSDictionary` to an
     * object (converted element by element), `NSNull` and `nil` to `null`.
     * Anything else comes back as the {@link ObjCObject} it was; JavaScript
     * values pass through unchanged.
     */
    js(value: unknown): unknown;
    /**
     * The reverse of {@link ObjC.js}: string to `NSString`, number and
     * boolean to `NSNumber`, `Date` to `NSDate`, `ArrayBuffer` or any view of
     * one to `NSData` (copied), array to `NSArray`, plain object to
     * `NSDictionary`, `null`/`undefined` to `nil` (returned as `null`).
     * An `ObjCObject` comes back as it is.
     */
    ns(value: unknown): ObjCObject | null;
    /**
     * Whether `a` and `b` are handles on the same Objective-C object. One
     * object has one handle, so this is `a === b` for handles; anything that
     * is not a handle, including `null`, is not the same as anything.
     */
    same(a: ObjCObject | ObjCClass | null | undefined, b: ObjCObject | ObjCClass | null | undefined): boolean;
    /** The property key under which every {@link ObjCObject} and {@link ObjCClass} reports its address as a `bigint`. */
    readonly pointer: unique symbol;
    /**
     * `NSNotFound` (`NSIntegerMax`, 2^63 - 1), as the `bigint` that
     * `indexOfObject:`, `rangeOfString:` and the like return when there is
     * no match. Integer results above 2^53 are always `bigint`s, so
     * `list.indexOfObject_(x) === objc.NSNotFound` is exact.
     */
    readonly NSNotFound: bigint;
  }

  /**
   * The bridge: every class and selector of the frameworks it loads
   * (Foundation, AppKit, QuartzCore, Metal, MetalKit), under Apple's own
   * names; `bun:appkit`'s windows and views are written on it. It does not
   * need the app to be running.
   *
   * Foundation and the parts of AppKit that are not user interface work in
   * a `Worker` as on the main thread: each thread has its own handles (the
   * same object is a different {@link ObjCObject} in each, `===` within
   * one), its own autorelease pool around every call, and its own defined
   * classes and blocks, whose functions run only on that thread and, a
   * Worker having no run loop, only when called synchronously inside its
   * own sends. Off the main thread the bridge refuses the receiver (never
   * the arguments) of a message when its class is, or inherits, one the
   * AppKit headers mark main-thread-only (`NSResponder` and so every view,
   * control, window, controller and the application; `NSCell`, `NSAlert`,
   * `NSToolbar`, `NSTouchBar`, `NSTableColumn`, `NSDocument`, gesture
   * recognizers, collection-view layouts, print panels, …) or `NSMenu`,
   * `NSMenuItem`, `NSStatusBar`, `NSStatusItem`, `NSNib`, `NSStoryboard` or
   * `NSDockTile`: sending to it, allocating it or subclassing it is an
   * `ERR_OBJC_WRONG_THREAD` error naming the class, except for `class`,
   * `isKindOfClass:`, `respondsToSelector:`, `description` and the other
   * `NSObject` introspection messages. {@link ObjCApp.start `app.start()`}
   * and everything in `bun:appkit` throw there too. When a
   * `Worker` exits, the blocks and classes it defined stay valid for
   * whoever still holds them but run nothing: a call answers `0` / `NO` /
   * `nil`, and the first one says so on stderr.
   *
   * Where a method takes a block, pass a function (for the methods whose
   * block type the bridge knows) or {@link ObjC.block `objc.block(fn, types)`};
   * where it takes a pointer to a value (`NSError **`, `double *`,
   * `NSRangePointer`), pass {@link ObjC.out `objc.out()`} or `null`.
   * Where it takes a C array or buffer it reads or fills (`unichar *`
   * with a `range:`, `id objects[]` with a `count:`, `char *`,
   * `const CGFloat *`), pass an `ArrayBuffer` or typed array, lent for the
   * call and never kept by the method: its byte length is checked against
   * the `count:`, `length:` or `range:` argument when the method has one
   * (`getCharacters:range:` into a `Uint16Array`), or `null`; any other
   * pointer (`void *`, `NSZone *`) takes the same, or the `bigint` address
   * a pointer result gave (a pointer result is `null` for `NULL` and
   * otherwise its address as a `bigint`). A Core Foundation type (every
   * `…Ref` the SDK declares with a `…GetTypeID()`: `CGColorRef`,
   * `CGPathRef`, `CTFontRef`, `SecCertificateRef`, …) crosses as an object
   * handle either way (they are Objective-C objects at run time), so
   * `layer.setBackgroundColor_(color.CGColor())` works; a handle on an
   * object of that type, checked with `CFGetTypeID`, or `null` is accepted
   * as one, a toll-free bridged type (`CFStringRef`, `CFArrayRef`,
   * `CFDictionaryRef`, …) also takes what its class takes (a string for a
   * `CFStringRef`), `CFTypeRef` takes any object, and the result of a
   * `Create…`/`Copy…` function is released with its handle. Not
   * converted: structs or unions holding an array, bit-field, pointer
   * or `long double` or larger than 128 bytes, and SIMD vectors (any
   * other struct passed by value crosses: `CGRect`, `NSRange`,
   * `NSEdgeInsets`, `CGAffineTransform`, `CATransform3D` and the like as
   * objects with the field names, `MTLSize`, `CMTime` and anything else as
   * an array of its members in order, which every struct also accepts
   * going in); pointer and C-string results of methods and blocks you
   * define; those throw a `TypeError`. So do `performSelector:`
   * and its object-returning variants, whose result cannot be typed: send
   * the selector itself. C functions are {@link ObjC.functions `objc.functions`}
   * and {@link ObjC.fn `objc.fn()`}. A variadic method (`arrayWithObjects:`,
   * `dictionaryWithObjectsAndKeys:`, `stringWithFormat:`,
   * `predicateWithFormat:`) takes its variable arguments after the named
   * ones, each as an object (handle, string, number, boolean or, for a
   * format, `null`); a nil-terminated list gets its `nil` added (a `null`
   * among the variable arguments there is a `TypeError`), and a format may
   * use `%@` (and `%K`) conversions only. One that reads C values there, or takes a
   * `va_list`, is a `TypeError`. A
   * window returned by an `init…` or `new…` message, or by a class method of
   * a window class, has `releasedWhenClosed` turned off, so closing it
   * leaves the handle valid. `NSProxy` instances work as receivers; an
   * unknown selector on one is a `TypeError` when the proxy answers
   * `methodSignatureForSelector:` with `nil`. An Objective-C exception
   * raised by the method you call (or by a proxy resolving it) is thrown as
   * an {@link ObjCException}.
   *
   * @example
   * ```ts
   * import { objc } from "bun:objc";
   * const { NSProcessInfo } = objc.classes;
   * console.log(`${NSProcessInfo.processInfo().operatingSystemVersionString()}`);
   *
   * import { Window } from "bun:appkit";
   * const win = new Window({ title: "t", visible: false });
   * win.native.setTitleVisibility_(objc.enums.NSWindowTitleVisibility.hidden);
   * ```
   */
  export const objc: ObjC;

  /** The `NSApplication` lifecycle: {@link ObjCApp}. The same object as {@link ObjC.app `objc.app`}. */
  export const app: ObjCApp;

  // Every member of {@link objc} is also exported by name:
  // `import { classes, defineClass } from "bun:objc"`.
  /** {@link ObjC.classes `objc.classes`}. */
  export const classes: ObjC["classes"];
  /** {@link ObjC.protocols `objc.protocols`}. */
  export const protocols: ObjC["protocols"];
  /** {@link ObjC.constants `objc.constants`}. */
  export const constants: ObjC["constants"];
  /** {@link ObjC.constant `objc.constant()`}. */
  export const constant: ObjC["constant"];
  /** {@link ObjC.enums `objc.enums`}. */
  export const enums: ObjC["enums"];
  /** {@link ObjC.functions `objc.functions`}. */
  export const functions: ObjC["functions"];
  /** {@link ObjC.fn `objc.fn()`}. */
  export const fn: ObjC["fn"];
  /** {@link ObjC.pointer `objc.pointer`}. */
  export const pointer: ObjC["pointer"];
  /** {@link ObjC.NSNotFound `objc.NSNotFound`}. */
  export const NSNotFound: ObjC["NSNotFound"];
  /** {@link ObjC.sel `objc.sel()`}. */
  export const sel: ObjC["sel"];
  /** {@link ObjC.js `objc.js()`}. */
  export const js: ObjC["js"];
  /** {@link ObjC.ns `objc.ns()`}. */
  export const ns: ObjC["ns"];
  /** {@link ObjC.same `objc.same()`}. */
  export const same: ObjC["same"];
  /** {@link ObjC.out `objc.out()`}. */
  export const out: ObjC["out"];
  /** {@link ObjC.defineClass `objc.defineClass()`}. */
  export const defineClass: ObjC["defineClass"];
  /** {@link ObjC.target `objc.target()`}. */
  export const target: ObjC["target"];
  /** {@link ObjC.block `objc.block()`}. */
  export const block: ObjC["block"];
  const super_: ObjC["super"];
  /** {@link ObjC.super `objc.super()`}; a reserved word, so `import { super as objcSuper }`. */
  export { super_ as super };

  /**
   * `import bridge from "bun:objc"`: the whole module, which is the bridge
   * with {@link objc} (itself) and {@link app} on it.
   */
  const _default: ObjC & { readonly objc: ObjC };
  export default _default;
}
