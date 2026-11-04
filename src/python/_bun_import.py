"""JavaScript modules, imported by Python.

    import helper                  helper.ts (or .js, .mjs, .tsx, ...) in a directory of sys.path, or beside the importing
    from . import helper           module of a package. A Python module of that name comes first.
    import lodash                  A package in node_modules, found from the importing file as JavaScript's import finds it.
    from node import fs            node:fs
    from bun import serve, sqlite  Bun.serve, bun:sqlite
    importlib.import_module("@scope/name/sub.js")   Any specifier at all.

What is imported is what require() returns: the exports of the module, a JavaScript object like any other.
"""

import sys

import _bun_resolver
import _frozen_importlib as _bootstrap
import _frozen_importlib_external as _external
import _js
import js

_SUFFIXES = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]

_IMPORT_SYSTEM = ("importlib", "_frozen_importlib", "_frozen_importlib_external", __name__)

_create_require = None


def _require(specifier, importer):
    """require(specifier) in the file `importer`.

    Bun's resolver fetches a package that is not installed from the registry. Not for Python: a name that Python code tries to
    import may be a module that is merely optional, or a typing error. That goes for what the module imports in its turn.
    """
    global _create_require
    if _create_require is None:
        _create_require = js.process.getBuiltinModule("node:module").createRequire
    return _bun_resolver.without_installing(_create_require(importer), specifier)


def _resolve(specifier, importer):
    return _bun_resolver.without_installing(js.Bun.resolveSync, specifier, importer)


def _importer():
    """The file whose import statement is being carried out, or the working directory. None: that is gone."""
    frame = sys._getframe(1)
    while frame is not None:
        if frame.f_globals.get("__name__", "").partition(".")[0] not in _IMPORT_SYSTEM:
            file = frame.f_globals.get("__file__")
            if isinstance(file, str) and file.startswith("/"):
                return file
            break
        frame = frame.f_back
    try:
        return _external._os.getcwd() + "/"
    except OSError:
        return None


def _is_installed(specifier, importer):
    """Whether the package is in a node_modules directory above the importer: cheaper to find out than what it resolves to."""
    parts = specifier.split("/")
    package = "/".join(parts[:2]) if specifier.startswith("@") else parts[0]
    directory = _external._path_split(importer)[0]
    while True:
        if _external._path_isdir(_external._path_join(directory, "node_modules", package)):
            return True
        parent = _external._path_split(directory)[0]
        if parent == directory:
            return False
        directory = parent


class JSLoader:
    """Loads what `specifier` means to the file `importer`."""

    def __init__(self, specifier, importer):
        self.specifier = specifier
        self.importer = importer

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        # The import system hands out what is in sys.modules when the module has run.
        sys.modules[module.__name__] = _require(self.specifier, self.importer)


class JSFileLoader(JSLoader):
    """What importlib's FileFinder makes for a file with one of the suffixes."""

    def __init__(self, fullname, path):
        super().__init__(path, path)
        self.name = fullname
        self.path = path


def _require_from_importer(specifier):
    """bun.require(specifier): any specifier at all, as JavaScript's require() in the calling file takes it."""
    importer = _importer() or "/"
    if not specifier.startswith(("/", "./", "../", "node:", "bun:", "#")) and not _is_installed(specifier, importer):
        raise ModuleNotFoundError(f"No package named {specifier!r} in node_modules", name=specifier)
    return _require(specifier, importer)


class _Namespace:
    """`node` and `bun`: packages that are no directory."""

    def __init__(self, name):
        self.name = name

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        if self.name == "bun":
            module.__getattr__ = lambda name: getattr(js.Bun, name)
            module.__dir__ = lambda: dir(js.Bun)
            module.require = _require_from_importer


class JSFinder:
    """The last finder of sys.meta_path: what is no Python module may be a JavaScript one."""

    @staticmethod
    def find_spec(fullname, path=None, target=None):
        head, dot, tail = fullname.partition(".")
        if head in ("node", "bun") and "/" not in fullname:
            if not dot:
                return _bootstrap.ModuleSpec(fullname, _Namespace(head), origin="bun", is_package=True)
            specifier = head + ":" + tail.replace(".", "/")
            if not js.process.getBuiltinModule("node:module").isBuiltin(specifier):
                return None
            return _bootstrap.ModuleSpec(fullname, JSLoader(specifier, "/"), origin=specifier)
        # No file has a NUL in its name, and asking for one is an error of another kind. So it is with a lone surrogate.
        if path is not None or not fullname.isprintable():
            return None
        verbatim = not fullname.isidentifier()
        # `import readline` is never node:readline, nor is a module the standard library lacks here a package of that name.
        if not verbatim and (fullname.startswith("_") or fullname in sys.stdlib_module_names):
            return None
        importer = _importer()
        if importer is None:
            return None
        for specifier in (fullname,) if verbatim or "_" not in fullname else (fullname, fullname.replace("_", "-")):
            if not specifier.startswith(("/", "node:", "bun:")) and not _is_installed(specifier, importer):
                continue
            try:
                resolved = _resolve(specifier, importer)
            except _js.JSError:
                continue
            if not verbatim and not resolved.startswith("/"):
                continue
            # The path of a file says nothing about what is in it: only its suffix does.
            if specifier.startswith("/") and not resolved.endswith(tuple(_SUFFIXES)):
                continue
            return _bootstrap.ModuleSpec(fullname, JSLoader(resolved, importer), origin=resolved)
        return None


class _GivenSource(_external.SourceLoader):
    """Loads source text that is in no file: a plugin supplied it."""

    def __init__(self, path, source):
        self.path = path
        self.source = source

    def get_filename(self, fullname):
        return self.path

    def get_data(self, path):
        return self.source.encode()


def _name_of_file(path):
    """The directory that has to be on sys.path for the file to be importable, and its name as a module then."""
    directory, file = _external._path_split(path)
    name = file.rpartition(".")[0] or file
    if name == "__init__":
        directory, name = _external._path_split(directory)
    while _external._path_isfile(_external._path_join(directory, "__init__.py")):
        directory, package = _external._path_split(directory)
        name = package + "." + name
    return directory, name


def _is_from(module_or_spec, directory, name):
    """Whether the top-level module, or what was found for its name, is the one in the directory."""
    origin = getattr(module_or_spec, "__file__", None) or getattr(module_or_spec, "origin", None)
    return origin in (_external._path_join(directory, name + ".py"), _external._path_join(directory, name, "__init__.py"))


_files = {}


def import_file(path, source=None):
    """What `import "/directory/file.py"` in JavaScript evaluates to: the module.

    A file is one module however often and from wherever it is imported, and it is the module that Python's own import of
    it gives, if Python can import it: its directory goes to the end of sys.path, where it hides nothing. If the name means
    something else to Python (another file of that name was imported first, the standard library has such a module), the
    file is a module all the same, under a name of its own.
    """
    module = _files.get(path)
    if module is not None:
        return module
    main = sys.modules.get("__main__")
    if source is None and getattr(main, "__file__", None) == path:
        return main

    directory, name = _name_of_file(path)
    if source is None:
        if directory not in sys.path:
            sys.path.append(directory)
        top = name.partition(".")[0]
        found = sys.modules.get(top) or _bootstrap._find_spec(top, None)
        if found is not None and _is_from(found, directory, top):
            module = _files[path] = _bootstrap._gcd_import(name)
            return module
        if top != name:
            raise ImportError(f"cannot import {path!r}: another {top!r} is imported already, or comes first on sys.path", name=name, path=path)

    name = "%s_%x" % (name.rpartition(".")[2], hash(path) & 0xFFFFFFFF)
    if source is None:
        spec = _external.spec_from_file_location(name, path)
    else:
        spec = _bootstrap.spec_from_loader(name, _GivenSource(path, source), origin=path)
        spec.has_location = True
    module = _files[path] = _bootstrap._load(spec)
    return module


def _spawn_only(context):
    """multiprocessing.context takes it that whatever is not Windows can fork. Here, as there, processes are spawned."""

    class Contexts(dict):
        # "fork" is not one of the start methods there are. Who asks for its context by name still gets it, and can make locks
        # and queues with it, as test.support does on Linux to see whether they work. It starts no process.
        def __missing__(self, name):
            if name != "fork":
                raise KeyError(name)
            return fork

    contexts = context._concrete_contexts = Contexts(context._concrete_contexts)
    fork = contexts.pop("fork")
    contexts.pop("forkserver")
    context._get_platform_default_context = lambda: contexts["spawn"]


_ADAPTATIONS = {"multiprocessing.context": _spawn_only}


class _AdaptingLoader:
    """Has the loader of a module of the standard library load it, then adapts it to what it cannot know about this platform."""

    def __init__(self, loader, adapt):
        self._loader = loader
        self._adapt = adapt

    def create_module(self, spec):
        return self._loader.create_module(spec)

    def exec_module(self, module):
        module.__spec__.loader = module.__loader__ = self._loader
        self._loader.exec_module(module)
        self._adapt(module)


class _Adapter:
    """Comes before PathFinder in sys.meta_path, for the few modules above."""

    @staticmethod
    def find_spec(fullname, path=None, target=None):
        adapt = _ADAPTATIONS.get(fullname)
        if adapt is None:
            return None
        spec = _external.PathFinder.find_spec(fullname, path, target)
        if spec is not None and spec.loader is not None:
            spec.loader = _AdaptingLoader(spec.loader, adapt)
        return spec


def _install():
    hook = _external.FileFinder.path_hook(*_external._get_supported_file_loaders(), (JSFileLoader, _SUFFIXES))
    for index, existing in enumerate(sys.path_hooks):
        if getattr(existing, "__qualname__", "").startswith("FileFinder."):
            sys.path_hooks[index] = hook
            break
    else:
        sys.path_hooks.append(hook)
    sys.path_importer_cache.clear()
    sys.meta_path.insert(sys.meta_path.index(_external.PathFinder), _Adapter)
    sys.meta_path.append(JSFinder)


_install()
