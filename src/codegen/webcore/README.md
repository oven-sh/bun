# The generated part of `bun:dom`

`bun:dom` is WebKit's DOM (WebCore), compiled into Bun. Most of it is in `src/jsc/bindings/webcore/`, in the same directories as upstream (`dom/`, `html/`, `css/`, ...).

`src/jsc/bindings/webcore/generated/` holds the files that WebKit's build makes with scripts: the JavaScript bindings (`JSNode.cpp`), the tag and attribute names (`HTMLNames.h`, `NodeName.cpp`), the element factories, the HTML entity table and a few more. Those files are checked in, so building Bun needs neither a WebKit checkout nor Perl.

**Nothing in `generated/` is edited by hand.** The scripts in this directory make every file in it. To change a generated file, change a script, a table or an IDL file here and regenerate.

The same holds for three files outside that directory, the CSS property tables: `src/jsc/bindings/webcore/css/CSSPropertyNames.{h,cpp}` and `src/css/dom/properties.rs`. One script writes all three, so that the property numbers in C++ and in Rust agree.

## What is here

| File                       | What it does                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `generate.ts`              | The entry point.                                                                                         |
| `upstream.ts`              | Runs WebKit's own generators.                                                                            |
| `bindings.ts`              | Turns the bindings that WebKit's generator prints into the ones Bun compiles.                            |
| `bindings-rules.ts`        | The tables `bindings.ts` works from: settings, removed members, rules for single files.                  |
| `names.ts`                 | Does the same for the tag and attribute names and the element factories.                                 |
| `lists.ts`                 | Makes the lists of all bindings that the global object, the `bun:dom` module and `new Window()` include. |
| `css-properties.ts`        | Makes the CSS property tables, for C++ and for Rust, from one list.                                      |
| `css-initial-values.json`  | Data for `css-properties.ts`: the initial computed value of each property in three browsers.             |
| `interfaces.txt`           | The interfaces, dictionaries, enumerations and callbacks that have a binding, one per line.              |
| `idl/`                     | IDL files that differ from upstream's. A file here wins over upstream's file of the same name.           |
| `import.ts`                | Copies a source file from a WebKit checkout into Bun.                                                    |
| `differs-from-upstream.md` | Where Bun's copy of WebCore differs from upstream on purpose, and why.                                   |

## Regenerating

You need a WebKit checkout, `perl`, `python3` and `ruby`. The checkout should be the commit that `differs-from-upstream.md` names. With another commit the output changes wherever upstream changed.

```sh
bun src/codegen/webcore/generate.ts
```

The scripts look for the checkout in `vendor/WebKit`. To use another one, give the path of its `Source/WebCore`:

```sh
bun src/codegen/webcore/generate.ts --webcore=/path/to/WebKit/Source/WebCore
WEBCORE_SOURCE_DIR=/path/to/WebKit/Source/WebCore bun src/codegen/webcore/generate.ts
```

WebKit's generator takes the mixins and partial interfaces of an interface in the order of their files' real paths, and the members come out in that order. The path of the checkout has to sort after the path of `idl/`, as `vendor/WebKit` does. Otherwise `JSDocument.cpp`, `JSHTMLElement.cpp` and `JSSVGElement.cpp` get their members in another order.

A full run takes about ten seconds. It writes only the files that changed, and it deletes files in `generated/` that it no longer makes.

Other ways to run it:

```sh
# Only these bindings, and the lists.
bun src/codegen/webcore/generate.ts Node HTMLDivElement

# Write nothing. Fail if generated/ is not what a run would write.
bun src/codegen/webcore/generate.ts --check

# Write somewhere else.
bun src/codegen/webcore/generate.ts --out=/tmp/generated
```

## Adding an interface

1. Import the implementation, if Bun does not have it yet (see below), and make it compile.
2. Run `bun src/codegen/webcore/generate.ts TheInterface`. This adds the name to `interfaces.txt`, writes `JSTheInterface.{h,cpp}` and updates the lists. Dictionaries, enumerations and callbacks that have an IDL file of their own need the same (`generate.ts TheInterfaceInit`).
3. Build. Every `.cpp` file under `src/jsc/bindings/webcore/` is compiled, so there is no list of sources to update.

The interface is now exported from `bun:dom` and is a property of every `Window`. To keep it from script, add it to `hiddenInterfaces` in `bindings-rules.ts`.

If the generator stops with `no value for xyzEnabled`, the interface has a member with `[EnabledBySetting=xyzEnabled]`. Bun has no settings: say in `settings` in `bindings-rules.ts` whether the member exists.

### When the binding does not fit

The binding calls the implementation, so it fails to compile when Bun's copy of the class lacks a member or declares it differently. In order of preference:

- **A member that Bun does not implement:** add it to `removedMembers` in `bindings-rules.ts`. This also works for members that come from a mixin or a partial interface.
- **Several changes to one interface:** copy upstream's IDL file to `idl/` and edit the copy. Keep the license header, and delete rather than comment out.
- **A change that IDL cannot express:** add a rule to `rulesForOneFile` in `bindings-rules.ts`, with a comment that says why. A rule is a regular expression and a replacement. Make the expression long enough to match only what you mean.

To drop an interface, delete its line in `interfaces.txt`, delete its file in `idl/` if it has one, and do a full run.

## Adding a CSS property

A full run picks up a property that is new in upstream's `CSSProperties.json`, and stops if `css-initial-values.json` has no entry for it. Add one: for each of WebKit, Chromium and Firefox, the result of `getComputedStyle(element).getPropertyValue(name)` for an element of an unknown tag with no style. Leave a browser out if `name in element.style` is false there. A property that no browser has is not exposed.

How a value is checked and written back is decided by the tables at the top of `css-properties.ts`. A shorthand that should be expanded needs an entry in `shorthands` there and an arm in `src/css/dom/declarations.rs`.

## Importing a file from upstream

```sh
bun src/codegen/webcore/import.ts Attr.h Attr.cpp
```

This copies the files to the directory they have upstream and rewrites `#include <WebCore/X.h>` to `#include "X.h"`. It never overwrites a file.

Change as little as you can in an imported file, so that the next update from WebKit is a small merge:

- Keep upstream's text, order and names.
- Delete what Bun cannot have (layout, rendering, loading, frames, the inspector). Do not leave it behind `#if 0`, and do not write stub classes to keep it compiling.
- Nothing that lives for the whole process may hold an `AtomString`, a `QualifiedName`, a node or a JavaScript cell. The DOM works on every thread in Bun, and those belong to one thread. State of that kind goes into `DOMClientData` (`dom/DOMClientData.h`), of which each VM has one.

## "Differs from upstream"

A file that has a counterpart in WebKit is either upstream's text or it **differs from upstream**: somebody changed it on purpose, beyond deleting what Bun does not have. A changed signature, a function that moved to another class and a template that became a run-time argument are differences of that kind.

They matter when Bun's copy is updated from a newer WebKit. The new upstream text does not have them, and whoever does the update has to put each one back or decide that it is no longer needed.

The list is `differs-from-upstream.md` in this directory. When you make such a change, add a line with the file, what changed and why.

For the generated files the scripts are the list: every difference is a rule or a table entry in `bindings-rules.ts`, `bindings.ts` or `names.ts`, or an edited file in `idl/`. Running `diff` between a file in `idl/` and upstream's file of the same name shows what was edited.
