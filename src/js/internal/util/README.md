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
