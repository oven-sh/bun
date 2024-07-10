# node-inspect-extracted

Vendored copy of [node-inspect-extracted](https://github.com/hildjj/node-inspect-extracted) with adaptations for Bun.
Some features not relevant to Bun have been removed. Others might be added or modified.

This library provides an as-faithful-as-possible implementation of Node.js's
[`util.inspect`](https://nodejs.org/api/util.html#util_util_inspect_object_options) function.

This is currently done for compatibility reasons. In the future, this should be replaced with a 100% native implementation.

## API

The following [`util`](https://nodejs.org/api/util.html) functions:

- [`inspect(object[,showHidden|options[,depth [, colors]]])`](https://nodejs.org/api/util.html#util_util_inspect_object_showhidden_depth_colors)
- [`format(format[, ...args])`](https://nodejs.org/api/util.html#util_util_format_format_args)
- [`formatWithOptions(inspectOptions, format[, ...args])`](https://nodejs.org/api/util.html#util_util_formatwithoptions_inspectoptions_format_args)

<!--And these extras:

- `stylizeWithColor(str, styleType)`: colorize `str` with ANSI escapes according to the styleType
- `stylizeWithHTML(str, styleType)`: colorize `str` with HTML span tags

## Colors

If you specify `{colors: true}` in the inspect options, you will get ANSI
escape codes, just as you would in Node. That's unlikely to be helpful to you
on the Web, so you might want `stylizeWithHTML`, which is also exported from the package:

```js
inspect(
  { a: 1 },
  {
    compact: false,
    stylize: stylizeWithHTML,
  },
);
```

which yields this ugly HTML:

```html
{ a: <span style="color:yellow;">1</span> }
```

If you want better HTML, the [lightly-documented](https://nodejs.org/api/util.html#util_custom_inspection_functions_on_objects) `stylize` option requires
a function that takes two parameters, a string, and a class name. The mappings
from class names to colors is in `inspect.styles`, so start with this:

```js
function stylizeWithHTML(str, styleType) {
  const style = inspect.styles[styleType];
  if (style !== undefined) {
    return `<span style="color:${style};">${str}</span>`;
  }
  return str;
}
```-->

## Known Limitations

- Objects that have been mangled with `Object.setPrototypeOf`
  do not retain their original type information.
  [[bug](https://github.com/hildjj/node-inspect-extracted/issues/3)]
- `WeakMap` and `WeakSet` will not show their contents, because those contents
  cannot be iterated over in unprivileged code.
- Colorful stack traces are not completely accurate with respect to what
  modules are Node-internal. This doesn't matter on the Web.

## LICENSE

This code is an adaptation of the Node.js internal implementation, mostly from
the file lib/internal/util/inspect.js, which does not have the Joyent
copyright header. The maintainers of this package will not assert copyright
over this code, but will assign ownership to the Node.js contributors, with
the same license as specified in the Node.js codebase; the portion adapted
here should all be plain MIT license.
