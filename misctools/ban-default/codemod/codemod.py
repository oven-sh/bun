#!/usr/bin/env python3
"""Rewrite the uses of core::default::Default in the workspace, from the facts the oracle collected.

Facts come from the rustc driver in /tmp/oracle (one .jsonl per crate and target). Every edit is a byte-span
replacement. What the tool cannot do with certainty is listed in the report, and is left untouched.
"""
import argparse
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--root", default="/workspace/bun")
ap.add_argument("--facts", nargs="+", default=["/tmp/oracle-out"])
ap.add_argument("--names", default="new,init,empty")
ap.add_argument("--overrides", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "overrides.json"))
ap.add_argument("--apply", action="store_true")
ap.add_argument("--report", default="/tmp/codemod/report.json")
ap.add_argument("--only", default="", help="comma list of path prefixes; edits outside are dropped (for trials)")
args = ap.parse_args()

ROOT = args.root
NAMES = args.names.split(",")
ONLY = [p for p in args.only.split(",") if p]

crates, impls, calls, obligs = load.load(args.facts)

# ----------------------------------------------------------------------------------------------------------
# source buffers and edits
# ----------------------------------------------------------------------------------------------------------
_bufs = {}


def buf(path):
    if path not in _bufs:
        with open(os.path.join(ROOT, path), "rb") as f:
            _bufs[path] = f.read()
    return _bufs[path]


def text(sp):
    return buf(sp["file"])[sp["lo"] : sp["hi"]].decode("utf-8", errors="replace")


def in_workspace(path):
    return path is not None and not path.startswith("/") and (path.startswith("src/") or path.startswith("packages/"))


edits = collections.defaultdict(list)  # file -> [(lo, hi, new_bytes, tag)]
report = collections.defaultdict(list)


def note(cat, sp, msg, **extra):
    row = {"file": sp.get("file") if sp else None, "line": sp.get("line") if sp else None, "msg": msg}
    row.update(extra)
    report[cat].append(row)


def edit(path, lo, hi, new, tag):
    if isinstance(new, str):
        new = new.encode("utf-8")
    edits[path].append((lo, hi, new, tag))


def line_start(b, pos):
    return b.rfind(b"\n", 0, pos) + 1


def line_end(b, pos):
    e = b.find(b"\n", pos)
    return len(b) if e < 0 else e


def indent_of(b, pos):
    ls = line_start(b, pos)
    m = re.match(rb"[ \t]*", b[ls:pos])
    return m.group(0).decode()


# ----------------------------------------------------------------------------------------------------------
# the type table: what replaces `<T as Default>::default()` for each workspace type
# ----------------------------------------------------------------------------------------------------------
class Manual(Exception):
    pass


class TypeInfo:
    unit = False
    overridden = False
    bitflags = False
    foreign_macro = False
    macro_def = None

    def __init__(self, key, adt):
        self.key = key
        self.name = adt["name"]
        self.kind = adt.get("kind")
        self.impls = []
        self.ctor = None  # ("fn", name) | ("suffix", "::X") | None
        self.why_manual = None
        self.live = False
        self.refs = set()  # keys of types whose Default this type's Default calls

    def use(self, path, tree=None, unsure=None):
        """The expression for this type's former default value, with the type named `path`."""
        if self.ctor is None:
            raise Manual(f"no constructor decided for {self.key[0]}{self.key[1]}: {self.why_manual}")
        kind, val = self.ctor
        if self.unit and tree is not None and strip_generics(path).split("::")[-1] not in (self.name, "Self"):
            # a type alias does not name the value of a unit struct
            path = tree["site_path"]
        path = expr_path(path)
        if kind == "fn":
            return Rendered(f"{path}::{val}()", cheap=False, fnpath=f"{path}::{val}")
        if kind == "wrap":
            # a generic wrapper: its default is a constructor applied to the default of one type argument
            if tree is None or len(tree.get("targs", [])) <= val["targ"]:
                raise Manual(f"wrapper {self.name} without its type argument")
            inner = render(tree["targs"][val["targ"]], unsure=unsure)
            return Rendered(f"{strip_generics(path)}{val['pre']}{inner.text}{val['post']}", cheap=False, fnpath=None)
        text_ = f"{path}{val}"
        if val.endswith("()"):
            return Rendered(text_, cheap=False, fnpath=text_[:-2])
        return Rendered(text_, cheap=True, fnpath=None)


class Rendered:
    def __init__(self, text_, cheap, fnpath):
        self.text = text_
        self.cheap = cheap  # a constant, a unit variant or a literal: fine to evaluate eagerly
        self.fnpath = fnpath  # a path to a zero-argument function that returns the same value


def expr_path(type_text):
    """A type as written in type position, made usable as a path prefix in an expression."""
    t = type_text.strip()
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*(::<.*>)?", t, flags=re.S):
        return t
    if t.startswith("<") and t.endswith(">") and " as " not in t:
        return t
    return f"<{t}>"


def strip_generics(type_text):
    t = type_text.strip()
    depth = 0
    for i, c in enumerate(t):
        if c == "<":
            if depth == 0:
                j = i
                if t[:i].endswith("::"):
                    j = i - 2
                return t[:j]
            depth += 1
    return t


types = {}
for i in impls:
    adt = i.get("adt")
    if i.get("non_adt") or not adt:
        note("impl-manual", i["impl_span"], f"impl Default for a non-ADT type {i['self_ty']}")
        continue
    if not adt.get("workspace"):
        note("impl-manual", i["impl_span"], f"impl Default for a foreign type {i['self_ty']}")
        continue
    key = (adt["krate"], adt["path"])
    t = types.get(key)
    if t is None:
        t = types[key] = TypeInfo(key, adt)
    t.impls.append(i)

try:
    OVERRIDES = json.load(open(args.overrides))
except FileNotFoundError:
    OVERRIDES = {}


def inherent_names(t):
    # a name that some call already reaches through a trait must not become an inherent function:
    # the inherent one would take those calls over
    names = set(load.TRAIT_FN_NAMES.get(t.key, ()))
    for i in t.impls:
        for n in i["adt"].get("inherent", []):
            names.add(n["name"])
    return names


def decide_ctor(t):
    okey = t.key[0] + t.key[1]
    if okey in OVERRIDES:
        o = OVERRIDES[okey]
        t.ctor = (o["kind"], o["value"])
        t.overridden = True
        return
    t.overridden = False
    t.bitflags = False
    t.foreign_macro = False
    t.macro_def = None
    kinds = set()
    for i in t.impls:
        if i["derived"]:
            if i.get("derive_span", {}).get("exp"):
                t.why_manual = "derive(Default) comes from a macro expansion"
                return
            fields = i.get("fields", [])
            if (
                t.kind == "struct"
                and len(fields) == 1
                and (
                    fields[0]["init"].get("name") == "InternalBitFlags"
                    or "bitflags::__private::PublicFlags>::Internal" in fields[0].get("ty", "")
                )
            ):
                # `bitflags! { #[derive(Default)] struct F: u32 { .. } }`: the default is the empty set
                kinds.add(("suffix", "::empty()"))
                t.bitflags = True
                continue
            if t.kind == "enum":
                if "default_variant" not in i:
                    t.why_manual = "derived enum without a readable default variant"
                    return
                kinds.add(("suffix", "::" + i["default_variant"]))
            elif t.kind == "struct" and "Const" in i.get("ctor_kind", ""):
                # a unit struct: its one value is its name
                kinds.add(("suffix", ""))
                t.unit = True
            elif t.kind == "struct":
                if i.get("default_bounds") and any(b for b in i["default_bounds"]):
                    # `#[derive(Default)]` on a generic struct puts `T: Default` on the impl. The constructor
                    # only needs it when a field's value depends on T, which render() reports.
                    pass
                kinds.add(("fn", None))
            else:
                t.why_manual = "derive on a union"
                return
        else:
            m = i.get("manual")
            if not m:
                t.why_manual = "impl Default without a `default` fn body"
                return
            if i["impl_span"].get("exp"):
                d = m.get("delegate")
                macro = str(i["impl_span"].get("macro"))
                if "__impl_internal_bitflags" in macro:
                    t.foreign_macro = True
                    kinds.add(("suffix", "::empty()"))
                    continue
                if d and (d == "Self" or d.startswith("Self::")):
                    # the macro body names what the default is; the impl inside the macro is removed by hand
                    t.macro_def = macro
                    kinds.add(("suffix", d[len("Self") :]))
                    continue
                t.why_manual = "impl Default comes from a macro expansion: " + macro
                return
            if i.get("default_bounds"):
                t.why_manual = "impl Default has `: Default` bounds: " + ", ".join(i["default_bounds"])
                return
            d = m.get("delegate")
            if d and (d == "Self" or d.startswith("Self::")) and delegate_visible(i, m):
                kinds.add(("suffix", d[len("Self") :]))
            elif d and d.startswith(t.name + "::") and delegate_visible(i, m):
                kinds.add(("suffix", d[len(t.name) :]))
            else:
                kinds.add(("fn", None))
    if len(kinds) != 1:
        t.why_manual = f"{len(t.impls)} impls of different shapes"
        return
    kind, val = next(iter(kinds))
    if kind == "fn":
        taken = inherent_names(t)
        for n in NAMES:
            if n not in taken:
                val = n
                break
        else:
            t.why_manual = "every constructor name is taken: " + ",".join(NAMES)
            return
    t.ctor = (kind, val)


def delegate_visible(i, m):
    """A delegate is usable in place of default() only when it is as visible as the type."""
    fn = m.get("delegate_fn")
    if m.get("delegate_kind") in ("unit-variant", "unit-struct"):
        return True
    name = fn
    if name is None:
        d = m["delegate"]
        name = d.split("::")[-1]
    vis = i["adt"].get("vis", "")
    for n in i["adt"].get("inherent", []):
        if n["name"] == name:
            if n["vis"] == "Public":
                return True
            # Restricted(crate root) is as good as pub(crate)
            if vis != "pub" and "Restricted" in n["vis"] and re.search(r"DefId\(0:0 ", n["vis"]):
                return True
            return False
    return False


for t in types.values():
    decide_ctor(t)


# ----------------------------------------------------------------------------------------------------------
# rendering a default value
# ----------------------------------------------------------------------------------------------------------
EXTERN = {}


def register_extern(krate, name):
    def deco(fn):
        EXTERN[(krate, name)] = fn
        return fn

    return deco


def render(tree, suffix=False, path=None, unsure=None):
    """`path`: how the outermost type is already written at the site, when it is."""
    k = tree["k"]
    if k == "lit":
        s = tree["s"]
        if suffix and "prim" in tree:
            s = s + tree["prim"]
        fn = s[:-2] if s.endswith("()") else None
        return Rendered(s, cheap=not s.endswith(")") or s == "()", fnpath=fn)
    if k == "local":
        t = types.get((tree["krate"], tree["path"]))
        if t is None:
            raise Manual(f"{tree['ty']} has no Default impl that the tool saw")
        p = path
        if p is None:
            p = tree["site_path"]
            if not tree.get("site_ok", False) and unsure is not None:
                unsure.append(tree["site_path"])
        return t.use(p, tree, unsure)
    if k == "wrap":
        inner = render(tree["inner"], unsure=unsure)
        pre = tree["pre"]
        if path is not None:
            head = re.match(r"(?:[A-Za-z_][A-Za-z0-9_]*::)*([A-Za-z_][A-Za-z0-9_]*)(::new)?\($", pre)
            written = strip_generics(path)
            if head and written.split("::")[-1] == head.group(1):
                pre = expr_path(path) + (head.group(2) or "") + "("
        return Rendered(pre + inner.text + tree["post"], cheap=False, fnpath=None)
    if k == "tuple":
        items = [render(x, unsure=unsure) for x in tree["items"]]
        body = ", ".join(x.text for x in items)
        if len(items) == 1:
            body += ","
        return Rendered(f"({body})", cheap=all(x.cheap for x in items), fnpath=None)
    if k == "array":
        elem = render(tree["elem"], unsure=unsure)
        if tree["copy"] or elem.cheap:
            # a literal, a constant or a unit variant is a valid repeat operand for any length
            return Rendered(f"[{elem.text}; {tree['len']}]", cheap=elem.cheap, fnpath=None)
        return Rendered(f"core::array::from_fn(|_| {elem.text})", cheap=False, fnpath=None)
    if k == "extern":
        fn = EXTERN.get((tree["krate"], tree["name"]))
        if fn is None:
            raise Manual(f"foreign type {tree['ty']}")
        return fn(tree, path, unsure)
    why = tree.get("why", "unknown")
    if why.startswith("kind *mut "):
        return Rendered("core::ptr::null_mut()", cheap=True, fnpath=None)
    if why.startswith("kind *const "):
        return Rendered("core::ptr::null()", cheap=True, fnpath=None)
    if re.fullmatch(r"generic Atomic std::sync::atomic::Atomic<\*mut .*>", why):
        return Rendered("core::sync::atomic::AtomicPtr::new(core::ptr::null_mut())", cheap=False, fnpath=None)
    m = re.fullmatch(r"generic Atomic std::sync::atomic::Atomic<(\w+)>", why)
    if m:
        prim = m.group(1)
        if prim == "bool":
            return Rendered("core::sync::atomic::AtomicBool::new(false)", cheap=False, fnpath=None)
        return Rendered(f"core::sync::atomic::Atomic{prim[0].upper()}{prim[1:]}::new(0)", cheap=False, fnpath=None)
    raise Manual(why)


def crate_has_dep(crate_dir_cache={}):
    return crate_dir_cache


_SITE = {"file": None}


def site_crate_deps():
    """Dependency names of the crate that owns the file being edited."""
    f = _SITE["file"]
    if not f:
        return set()
    d = os.path.dirname(f)
    while d and d != "src" and not os.path.exists(os.path.join(ROOT, d, "Cargo.toml")):
        d = os.path.dirname(d)
    key = d
    cache = site_crate_deps.cache
    if key not in cache:
        deps = set()
        try:
            for line in open(os.path.join(ROOT, d, "Cargo.toml")):
                m = re.match(r"\s*([A-Za-z0-9_\-]+)\s*(=|\.workspace)", line)
                if m:
                    deps.add(m.group(1).replace("-", "_"))
        except FileNotFoundError:
            pass
        cache[key] = deps
    return cache[key]


site_crate_deps.cache = {}


def fx_names():
    deps = site_crate_deps()
    if "rustc_hash" in deps:
        return "rustc_hash::FxHashMap", "rustc_hash::FxHashSet", "rustc_hash::FxBuildHasher"
    if "bun_sema" in deps:
        return "bun_sema::util::FxHashMap", "bun_sema::util::FxHashSet", "bun_sema::util::FxBuild"
    raise Manual("FxBuildHasher is not nameable: the crate depends on neither rustc-hash nor bun_sema")


def hasher_expr(tree, unsure=None):
    if tree["k"] == "extern" and tree["krate"] == "rustc_hash" and tree["name"] == "FxBuildHasher":
        return fx_names()[2]
    if tree["k"] == "local":
        # one of our BuildHasher types
        return render(tree, unsure=unsure).text
    raise Manual(f"hash map with hasher {tree.get('ty') or tree.get('why')}")


@register_extern("hashbrown", "HashMap")
def _hb_hashmap(tree, path, unsure):
    h = hasher_expr(tree["targs"][2], unsure)
    if path is None:
        raise Manual(f"hashbrown map {tree['ty']} without a written type")
    return Rendered(f"{expr_path(path)}::with_hasher({h})", cheap=False, fnpath=None)


@register_extern("hashbrown", "HashSet")
def _hb_hashset(tree, path, unsure):
    h = hasher_expr(tree["targs"][1], unsure)
    if path is None:
        raise Manual(f"hashbrown set {tree['ty']} without a written type")
    return Rendered(f"{expr_path(path)}::with_hasher({h})", cheap=False, fnpath=None)


@register_extern("std", "HashMap")
def _hashmap(tree, path, unsure):
    h = hasher_expr(tree["targs"][2], unsure)
    head = expr_path(path) if path is not None else fx_names()[0]
    return Rendered(f"{head}::with_hasher({h})", cheap=False, fnpath=None)


@register_extern("std", "HashSet")
def _hashset(tree, path, unsure):
    h = hasher_expr(tree["targs"][1], unsure)
    head = expr_path(path) if path is not None else fx_names()[1]
    return Rendered(f"{head}::with_hasher({h})", cheap=False, fnpath=None)


@register_extern("rustc_hash", "FxBuildHasher")
def _fxbuild(tree, path, unsure):
    return Rendered(expr_path(path) if path is not None else fx_names()[2], cheap=True, fnpath=None)


@register_extern("smallvec", "SmallVec")
def _smallvec(tree, path, unsure):
    head = expr_path(path) if path is not None else "smallvec::SmallVec"
    return Rendered(f"{head}::new()", cheap=False, fnpath=f"{head}::new")


@register_extern("enumset", "EnumSet")
def _enumset(tree, path, unsure):
    head = expr_path(path) if path is not None else "enumset::EnumSet"
    return Rendered(f"{head}::empty()", cheap=False, fnpath=f"{head}::empty")


@register_extern("bstr", "BString")
def _bstring(tree, path, unsure):
    head = strip_generics(path) if path is not None else "bstr::BString"
    return Rendered(f"{head}::new(Vec::new())", cheap=False, fnpath=None)


@register_extern("alloc", "Cow")
def _cow(tree, path, unsure):
    ty = tree["ty"]
    head = strip_generics(path) if path is not None else "std::borrow::Cow"
    if re.search(r"Cow<'[^,]*, \[", ty):
        return Rendered(f"{head}::Owned(Vec::new())", cheap=False, fnpath=None)
    if re.search(r"Cow<'[^,]*, str>", ty):
        return Rendered(f"{head}::Owned(String::new())", cheap=False, fnpath=None)
    raise Manual(f"foreign type {ty}")


@register_extern("core", "Range")
def _range(tree, path, unsure):
    inner = render(tree["targs"][0], unsure=unsure)
    return Rendered(f"{inner.text}..{inner.text}", cheap=False, fnpath=None)


@register_extern("std", "Once")
def _once(tree, path, unsure):
    return Rendered("std::sync::Once::new()", cheap=False, fnpath=None)


@register_extern("core", "Atomic")
def _atomic(tree, path, unsure):
    t0 = tree["targs"][0] if tree.get("targs") else None
    if t0 and t0["k"] == "lit" and "prim" in t0:
        name = "Atomic" + t0["prim"][0].upper() + t0["prim"][1:]
        return Rendered(f"core::sync::atomic::{name}::new(0)", cheap=False, fnpath=None)
    if t0 and t0["k"] == "lit" and t0["s"] == "false":
        return Rendered("core::sync::atomic::AtomicBool::new(false)", cheap=False, fnpath=None)
    raise Manual(f"foreign type {tree['ty']}")


def has_kind(tree, kinds):
    return any(n["k"] in kinds for n in load.tree_kinds(tree)) or any(
        n["k"] in kinds for x in load.tree_kinds(tree) if x["k"] == "extern" for t in x.get("targs", []) for n in load.tree_kinds(t)
    )


def local_keys(tree, out=None):
    """The workspace types whose `Default` the value of `tree` needs. A foreign container's `Default` does not need
    the `Default` of its element type (`Vec<T>`, `Option<T>`, `SmallVec<[T; N]>`): only the few type arguments
    below. A workspace wrapper listed in the overrides (`GuardedBy<T>`) needs its argument's."""
    out = out if out is not None else []
    k = tree["k"]
    if k == "local":
        out.append((tree["krate"], tree["path"]))
        if (tree["krate"] + tree["path"]) in OVERRIDES:
            for t_ in tree.get("targs", []):
                local_keys(t_, out)
    elif k == "wrap":
        local_keys(tree["inner"], out)
    elif k == "tuple":
        for t_ in tree["items"]:
            local_keys(t_, out)
    elif k == "array":
        local_keys(tree["elem"], out)
    elif k == "extern":
        targs = tree.get("targs", [])
        name = tree["name"]
        if name == "HashMap" and len(targs) > 2:
            local_keys(targs[2], out)
        elif name == "HashSet" and len(targs) > 1:
            local_keys(targs[1], out)
        elif name == "EnumMap" and len(targs) > 1:
            local_keys(targs[1], out)
        elif name == "Range" and targs:
            local_keys(targs[0], out)
    return out


# ----------------------------------------------------------------------------------------------------------
# liveness: which types' defaults does anything still need
# ----------------------------------------------------------------------------------------------------------
roots = set()
for c in calls:
    owner = c.get("owner_default_impl_of")
    keys = local_keys(c["init"])
    if owner:
        ok = (owner["krate"], owner["path"])
        if ok in types:
            types[ok].refs.update(keys)
            continue
    roots.update(keys)
for o in obligs:
    owner = o.get("owner_default_impl_of")
    keys = local_keys(o["init"])
    if owner:
        ok = (owner["krate"], owner["path"])
        if ok in types:
            types[ok].refs.update(keys)
            continue
    roots.update(keys)
for t in types.values():
    for i in t.impls:
        for f in i.get("fields", []):
            t.refs.update(local_keys(f["init"]))
stack = [k for k in roots if k in types]
while stack:
    k = stack.pop()
    t = types[k]
    if t.live:
        continue
    t.live = True
    stack.extend(r for r in t.refs if r in types and not types[r].live)


# ----------------------------------------------------------------------------------------------------------
# definitions
# ----------------------------------------------------------------------------------------------------------
def remove_from_derive(path, dsp):
    b = buf(path)
    lo, hi = dsp["lo"], dsp["hi"]
    target = b[lo:hi].strip()
    if not target.endswith(b"Default"):
        raise Manual(f"derive span does not cover `Default`: {target!r}")
    open_p = b.rfind(b"(", 0, lo)
    close_p = b.find(b")", hi)
    attr_lo = b.rfind(b"#[", 0, open_p)
    attr_hi = b.find(b"]", close_p) + 1
    if not re.fullmatch(rb"#\[\s*derive\s*", b[attr_lo:open_p]):
        raise Manual("derive attribute has an unexpected shape")
    inner = b[open_p + 1 : close_p]
    if b"//" in inner or b"/*" in inner:
        raise Manual("comment inside the derive list")
    items = [x.strip() for x in inner.split(b",") if x.strip()]
    keep = [x for x in items if x != target]
    if len(keep) != len(items) - 1:
        raise Manual("could not find exactly one `Default` in the derive list")
    if keep:
        return (attr_lo, attr_hi, b"#[derive(" + b", ".join(keep) + b")]")
    ls, le = line_start(b, attr_lo), line_end(b, attr_hi)
    if b[ls:attr_lo].strip() == b"" and b[attr_hi:le].strip() == b"":
        return (ls, min(le + 1, len(b)), b"")
    return (attr_lo, attr_hi, b"")


def split_top(s, sep=","):
    parts, depth, cur = [], 0, []
    for c in s:
        if c in "<([{":
            depth += 1
        elif c in ">)]}":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def impl_header(adt):
    """`impl<G> Name<Args> where W` for an inherent impl of this type."""
    g = (adt.get("generics") or "").strip()
    decls, argl = [], []
    if g:
        inner = g[1:-1] if g.startswith("<") and g.endswith(">") else g
        for p in split_top(inner):
            p = p.strip()
            if not p:
                continue
            # drop a default (`T = Foo`, `const N: usize = 4`), keep bounds
            eq = None
            depth = 0
            for idx, ch in enumerate(p):
                if ch in "<([{":
                    depth += 1
                elif ch in ">)]}":
                    depth -= 1
                elif ch == "=" and depth == 0 and p[idx - 1 : idx + 1] not in ("==", ">=", "<=") and p[idx : idx + 2] != "=>":
                    eq = idx
                    break
            decl = p[:eq].strip() if eq is not None else p
            decls.append(decl)
            if decl.startswith("const "):
                argl.append(decl[len("const ") :].split(":")[0].strip())
            else:
                argl.append(decl.split(":")[0].strip())
    gtxt = f"<{', '.join(decls)}>" if decls else ""
    atxt = f"<{', '.join(argl)}>" if argl else ""
    w = (adt.get("where") or "").strip()
    if w and not w.startswith("where"):
        w = "where " + w
    wtxt = f" {w}" if w else ""
    return f"impl{gtxt} {adt['name']}{atxt}{wtxt}"


CFG_ATTR = re.compile(rb"#\[\s*cfg\s*\((?:[^()\[\]]|\((?:[^()\[\]]|\((?:[^()\[\]]|\([^()\[\]]*\))*\))*\))*\)\s*\]")


def field_cfgs(i):
    """The #[cfg(..)] attributes written on each field of the struct, by field name."""
    out = {}
    fields = sorted((f for f in i["fields"] if "ty_span" in f), key=lambda f: f["ty_span"]["lo"])
    if not fields:
        return out
    b = buf(i["adt"]["item_span"]["file"])
    prev_end = i["adt"]["item_span"]["lo"]
    for f in fields:
        chunk = b[prev_end : f["ty_span"]["lo"]]
        cfgs = [m.group(0).decode() for m in CFG_ATTR.finditer(chunk)]
        if cfgs:
            out[f["name"]] = cfgs
        prev_end = f["ty_span"]["hi"]
    return out


def item_cfgs(b, item_lo):
    """#[cfg(..)] attributes on the lines directly above an item."""
    cfgs = []
    pos = line_start(b, item_lo)
    while pos > 0:
        prev_ls = line_start(b, pos - 1)
        line = b[prev_ls : pos - 1].strip()
        if line.startswith(b"#[") or line.startswith(b"///") or line.startswith(b"//") or line.startswith(b"#!["):
            m = CFG_ATTR.fullmatch(line)
            if m:
                cfgs.insert(0, line.decode())
            pos = prev_ls
            continue
        # the tail of a multi-line attribute: give up quietly, cfg attributes are one line in practice
        break
    return cfgs


def gen_struct_ctor(t, i):
    adt = i["adt"]
    isp = adt["item_span"]
    if isp.get("exp"):
        raise Manual("the struct is declared inside a macro expansion")
    if not in_workspace(isp.get("file")):
        raise Manual(f"the struct is in generated code: {isp.get('file')}")
    b = buf(isp["file"])
    _SITE["file"] = isp["file"]
    cfgs = field_cfgs(i)
    unsure = []
    rendered = []
    for f in i["fields"]:
        # the field's type as written names the type at this place for certain
        written = (f.get("ty_text") or "").strip()
        path = None
        if re.fullmatch(r"(::)?[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*(<.*>)?", written, flags=re.S):
            path = strip_generics(written)
        try:
            r = render(f["init"], path=path, unsure=unsure)
        except Manual as e:
            raise Manual(f"field `{f['name']}`: {e}")
        rendered.append((f["name"], r.text, cfgs.get(f["name"], [])))
    ck = i.get("ctor_kind", "None")
    ind = indent_of(b, isp["lo"])
    i1, i2, i3 = ind + "    ", ind + "        ", ind + "            "
    if "Const" in ck:
        body = f"{i2}Self\n"
    elif "Fn" in ck:
        if any(c for _, _, c in rendered):
            raise Manual("tuple struct with cfg on a field")
        body = f"{i2}Self({', '.join(x for _, x, _ in rendered)})\n"
    else:
        if rendered:
            lines = []
            for name, x, c in rendered:
                for a in c:
                    lines.append(f"{i3}{a}\n")
                if name in KEYWORDS:
                    name = "r#" + name
                lines.append(f"{i3}{name}: {x},\n")
            body = f"{i2}Self {{\n{''.join(lines)}{i2}}}\n"
        else:
            body = f"{i2}Self {{}}\n"
    vis = adt.get("vis", "").strip()
    vis = vis + " " if vis else ""
    head = impl_header(adt)
    attrs = "".join(f"{ind}{c}\n" for c in item_cfgs(b, isp["lo"]))
    name = t.ctor[1]
    code = f"\n\n{attrs}{ind}{head} {{\n{i1}#[inline]\n{i1}{vis}fn {name}() -> Self {{\n{body}{i1}}}\n{ind}}}"
    if unsure:
        note("path-unsure", isp, f"constructor of {t.name} names a type by a path the tool could not confirm", paths=sorted(set(unsure)))
    return (isp["hi"], isp["hi"], code.encode())


KEYWORDS = set(
    "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return "
    "static struct super trait true type unsafe use where while async await dyn abstract become box do final macro "
    "override priv typeof unsized virtual yield try gen".split()
)

DEFAULT_ATTR = re.compile(rb"#\[default\][ \t]*(\r?\n[ \t]*)?")


def rewrite_impl(t, i):
    """Edits for one impl of Default. Returns a list of (file, lo, hi, new, tag)."""
    out = []
    adt = i["adt"]
    if t.foreign_macro or (t.macro_def and i["impl_span"].get("exp")):
        return out
    if i["derived"]:
        dsp = i.get("derive_span")
        if not dsp or dsp.get("exp") or not in_workspace(dsp.get("file")):
            raise Manual("derive attribute is not in a source file the tool can edit")
        lo, hi, new = remove_from_derive(dsp["file"], dsp)
        out.append((dsp["file"], lo, hi, new, "derive"))
        if t.kind == "enum":
            isp = adt["item_span"]
            b = buf(isp["file"])
            ms = list(DEFAULT_ATTR.finditer(b, isp["lo"], isp["hi"]))
            if len(ms) != 1:
                raise Manual(f"expected one #[default] in the enum, found {len(ms)}")
            out.append((isp["file"], ms[0].start(), ms[0].end(), b"", "default-attr"))
        elif t.live and not t.bitflags and not t.unit:
            lo, hi, new = gen_struct_ctor(t, i)
            out.append((adt["item_span"]["file"], lo, hi, new, "ctor"))
        return out
    # hand-written impl
    isp = i["impl_span"]
    if not in_workspace(isp.get("file")):
        raise Manual(f"the impl is in generated code: {isp.get('file')}")
    m = i["manual"]
    b = buf(isp["file"])
    kind, val = t.ctor
    if kind == "suffix" or not t.live:
        # the impl only forwarded to something that exists, or nothing needs it: delete it with its attributes
        lo = line_start(b, isp["lo"])
        if b[lo : isp["lo"]].strip() != b"":
            lo = isp["lo"]
        else:
            while lo > 0:
                pls = line_start(b, lo - 1)
                line = b[pls : lo - 1].strip()
                if line.startswith(b"#[") or line.startswith(b"///"):
                    lo = pls
                else:
                    break
        hi = isp["hi"]
        le = line_end(b, hi)
        if b[hi:le].strip() == b"":
            hi = min(le + 1, len(b))
            # one blank line is enough between the neighbours
            if lo > 1 and b[lo - 2 : lo] == b"\n\n" and b[hi : hi + 1] == b"\n":
                hi += 1
        out.append((isp["file"], lo, hi, b"", "impl-delete"))
        return out
    fsp = m.get("fn_span")
    if not fsp or fsp.get("exp"):
        raise Manual("`fn default` is not in plain source")
    header = b[isp["lo"] : fsp["lo"]]
    hm = list(re.finditer(rb"(?:::)?(?:(?:core|std)::default::)?\bDefault\s+for\s+", header))
    if len(hm) != 1:
        raise Manual("could not find `Default for` in the impl header")
    out.append((isp["file"], isp["lo"] + hm[0].start(), isp["lo"] + hm[0].end(), b"", "impl-header"))
    fn_text = b[fsp["lo"] : fsp["hi"]]
    fm = re.match(rb"(?:default\s+)?fn\s+default\s*\(\s*\)", fn_text)
    if not fm:
        raise Manual("unexpected shape of `fn default()`")
    vis = adt.get("vis", "").strip()
    vis = vis + " " if vis else ""
    out.append((isp["file"], fsp["lo"], fsp["lo"] + fm.end(), f"{vis}fn {val}()".encode(), "impl-fn"))
    return out


impl_delete_ranges = collections.defaultdict(list)
for t in types.values():
    if t.ctor is None or getattr(t, "overridden", False):
        for i in t.impls:
            sp = i.get("derive_span") if i["derived"] else i["impl_span"]
            note(
                "type-manual",
                sp if sp and not sp.get("exp") else (sp or {}).get("callsite", i["impl_span"]),
                f"{t.key[0]}{t.key[1]}: {t.why_manual or 'override: the definition is edited by hand'}",
                live=t.live,
            )
        continue
    if t.macro_def:
        cs = t.impls[0]["impl_span"].get("callsite") or {}
        note("macro-def-manual", cs, f"{t.key[0]}{t.key[1]}: remove `impl Default` from the macro {t.macro_def}; uses now say `{t.name}{t.ctor[1]}`")
    batch = []
    try:
        for i in t.impls:
            batch.extend(rewrite_impl(t, i))
    except Manual as e:
        t.ctor_failed = str(e)
        sp = t.impls[0].get("derive_span") if t.impls[0]["derived"] else t.impls[0]["impl_span"]
        note("type-manual", sp, f"{t.key[0]}{t.key[1]}: {e}", live=t.live)
        # uses are still rewritten to the decided name: the definition is then written by hand
        continue
    for path, lo, hi, new, tag in batch:
        edit(path, lo, hi, new, tag)
        if tag == "impl-delete":
            impl_delete_ranges[path].append((lo, hi))


# ----------------------------------------------------------------------------------------------------------
# uses
# ----------------------------------------------------------------------------------------------------------
def site_ok(sp):
    return sp and not sp.get("exp") and in_workspace(sp.get("file"))


stats = collections.Counter()

# A call that a macro_rules body spells on one concrete type (`Foo::default()` with no metavariable) is the
# same tokens in every expansion. When every expansion also resolves it to the same type, the body is rewritten.
macro_body_calls = collections.defaultdict(list)
for c in calls:
    sp = c["span"]
    if sp.get("exp") and in_workspace(sp.get("file")) and "Bang" in str(sp.get("macro")):
        macro_body_calls[(sp["file"], sp["lo"], sp["hi"])].append(c)
macro_body_done = set()
for (mfile, mlo, mhi), group in macro_body_calls.items():
    first = group[0]
    if first["form"] != "typed" or not first["is_call"] or first.get("update"):
        continue
    if len({g["ty"] for g in group}) != 1:
        continue
    try:
        snippet = buf(mfile)[mlo:mhi].decode("utf-8")
    except (UnicodeDecodeError, FileNotFoundError):
        continue
    m = re.fullmatch(r"((?:[A-Za-z_][A-Za-z0-9_]*::)*[A-Za-z_][A-Za-z0-9_]*(?:::<[^$]*>)?)\s*::\s*default\s*\(\s*\)", snippet)
    if not m or "$" in snippet:
        continue
    _SITE["file"] = mfile
    try:
        r = render(first["init"], path=m.group(1))
    except Manual:
        continue
    if first["init"]["k"] != "local":
        continue
    edit(mfile, mlo, mhi, r.text, "macro-body-call")
    macro_body_done.add((mfile, mlo, mhi))
    stats["macro-body-call"] += 1

for c in calls:
    sp = c["span"]
    if not site_ok(sp):
        if (sp.get("file"), sp.get("lo"), sp.get("hi")) in macro_body_done:
            continue
        cs = sp.get("callsite") or sp
        note("call-in-macro", cs, f"Default::default() of `{c['ty']}` inside a macro expansion: {sp.get('macro')}")
        continue
    form = c["form"]
    tree = c["init"]
    _SITE["file"] = sp["file"]
    unsure = []
    try:
        if c.get("update"):
            u = c["update"]
            if tree["k"] != "local":
                raise Manual(f"struct update from the default of a foreign type {c['ty']}")
            r = render(tree, path=u["struct_path_text"])
            new = r.text
            tag = "update"
        else:
            path = c.get("type_text") if form in ("typed", "qself") else None
            if path is not None and tree["k"] in ("lit",):
                # `u32::default()` supplies the type itself, so the literal has to carry it
                need_suffix = c.get("ctx") not in ("field", "let-typed")
                r = render(tree, suffix=need_suffix)
                s = tree["s"]
                if s.endswith("::new()"):
                    written = strip_generics(path)
                    if written.split("::")[-1] == s[: -len("::new()")].split("::")[-1]:
                        r = Rendered(expr_path(path) + "::new()", cheap=False, fnpath=expr_path(path) + "::new")
                elif s == "None" and strip_generics(path).split("::")[-1] == "Option" and path.strip() != "Option":
                    r = Rendered(expr_path(path) + "::None", cheap=True, fnpath=None)
            elif path is not None and c.get("type_is_self") and tree["k"] != "local":
                raise Manual(f"Self::default() where Self is {c['ty']}")
            else:
                r = render(tree, path=path, unsure=unsure)
            if c["is_call"]:
                new = r.text
            else:
                new = r.fnpath if r.fnpath else f"|| {r.text}"
            tag = "call"
    except Manual as e:
        note("call-manual", sp, f"`{text(sp)[:80]}` of type `{c['ty']}`: {e}", form=form)
        continue
    if unsure:
        note("path-unsure", sp, "a type is named by a path the tool could not confirm", paths=sorted(set(unsure)), new=new)
    old = text(sp)
    if new == old:
        continue
    edit(sp["file"], sp["lo"], sp["hi"], new, tag)
    stats[tag] += 1

# ---- calls of our own generic functions whose signature changes ------------------------------------------
# The `: Default` bound of these functions goes away. Each call then says what the value is.
GOP = re.compile(r"(?:^|::)(ArrayHashMap|StringArrayHashMap|StringHashMap|HashMap|StaticHashMap)::<[^>]*>::(get_or_put|get_or_put_assume_capacity|get_or_put_adapted)$")
FILL = re.compile(r"(?:^|::)MimallocArena::alloc_slice_fill_default$")
JSCELL_TAKE = re.compile(r"(?:^|::)JsCell::<[^>]*>::take$")
OUR_OR_DEFAULT = re.compile(r"(?:^|::)(MapEntry|IdEntry|Entry)::<[^>]*>::or_default$")

ws_groups = collections.OrderedDict()
for o in obligs:
    if not o["callee_workspace"]:
        continue
    sp = o["span"]
    key = (sp.get("file"), sp.get("lo"), sp.get("hi"), o["callee"])
    g = ws_groups.setdefault(key, {"o": o, "params": {}})
    g["params"][o.get("param", "?")] = o["init"]

ws_handled = set()


def closure_of(r):
    return r.fnpath if r.fnpath else f"|| {r.text}"


def append_arg(path, sp, arg):
    b = buf(path)
    close = sp["hi"] - 1
    if b[close : close + 1] != b")":
        raise Manual("call does not end with `)`")
    k = close
    while k > 0 and b[k - 1 : k] in (b" ", b"\n", b"\t", b"\r"):
        k -= 1
    if b[k - 1 : k] == b",":
        ins = f" {arg}"
    elif b[k - 1 : k] == b"(":
        ins = arg
    else:
        ins = f", {arg}"
    edit(path, k, k, ins, "ws-arg")


for key, g in ws_groups.items():
    o = g["o"]
    sp = o["span"]
    callee = o["callee"]
    params = g["params"]
    rule = None
    if GOP.search(callee):
        rule = "gop"
    elif FILL.search(callee):
        rule = "fill"
    elif JSCELL_TAKE.search(callee):
        rule = "jscell-take"
    elif OUR_OR_DEFAULT.search(callee):
        rule = "or-default"
    if rule is None:
        continue
    ws_handled.add(key)
    if not site_ok(sp):
        cs = sp.get("callsite") or sp
        note("oblig-in-macro", cs, f"`{callee}` inside a macro expansion: {sp.get('macro')}")
        continue
    _SITE["file"] = sp["file"]
    unsure = []
    try:
        b = buf(sp["file"])
        if rule == "gop":
            if "V" not in params:
                continue  # this instantiation only carries the context or allocator bound
            rv = render(params["V"], unsure=unsure)
            if callee.endswith("get_or_put_adapted"):
                if "K" not in params:
                    raise Manual("get_or_put_adapted without the key type")
                rk = render(params["K"], unsure=unsure)
                arg = f"|| ({rk.text}, {rv.text})"
            else:
                arg = closure_of(rv)
            append_arg(sp["file"], sp, arg)
            stats["ws-gop"] += 1
        elif rule == "fill":
            rt = render(params["T"], unsure=unsure)
            msp = o["method"]["method_span"] if o["form"] == "method" else None
            if msp is None or not site_ok(msp):
                raise Manual("alloc_slice_fill_default is not called as a method here")
            after = b[msp["hi"] : sp["hi"]].decode()
            tt = params["T"]
            prim_or_cheap = tt["k"] == "lit" and ("prim" in tt or tt["s"] in ("false", "'\\0'"))
            if prim_or_cheap:
                edit(sp["file"], msp["lo"], msp["hi"], "alloc_slice_fill_copy", "ws-method")
                append_arg(sp["file"], sp, rt.text)
            else:
                edit(sp["file"], msp["lo"], msp["hi"], "alloc_slice_fill_with", "ws-method")
                m = re.match(r"\s*::<", after)
                if m:
                    # one more generic parameter: the closure type
                    depth = 0
                    for idx in range(m.end() - 1, len(after)):
                        if after[idx] == "<":
                            depth += 1
                        elif after[idx] == ">":
                            depth -= 1
                            if depth == 0:
                                pos = msp["hi"] + idx
                                edit(sp["file"], pos, pos, ", _", "ws-turbofish")
                                break
                append_arg(sp["file"], sp, f"|_| {rt.text}")
            stats["ws-fill"] += 1
        elif rule == "jscell-take":
            rt = render(params["T"], unsure=unsure)
            msp = o["method"]["method_span"]
            tail = b[msp["hi"] : sp["hi"]]
            if not re.fullmatch(rb"\s*\(\s*\)", tail):
                raise Manual(f"unexpected call tail {tail!r}")
            edit(sp["file"], msp["lo"], sp["hi"], f"replace({rt.text})", "ws-method")
            stats["ws-jscell"] += 1
        elif rule == "or-default":
            rv = render(params["V"], unsure=unsure)
            msp = o["method"]["method_span"]
            tail = b[msp["hi"] : sp["hi"]]
            if not re.fullmatch(rb"\s*\(\s*\)", tail):
                raise Manual(f"unexpected call tail {tail!r}")
            edit(sp["file"], msp["lo"], sp["hi"], f"or_insert_with({closure_of(rv)})", "ws-method")
            stats["ws-or-default"] += 1
    except Manual as e:
        note("oblig-manual", sp, f"`{callee}`: {e}")
        continue
    if unsure:
        note("path-unsure", sp, "a type is named by a path the tool could not confirm", paths=sorted(set(unsure)))

for o in obligs:
    sp = o["span"]
    tree = o["init"]
    if o["callee_workspace"] and (sp.get("file"), sp.get("lo"), sp.get("hi"), o["callee"]) in ws_handled:
        continue
    keys = local_keys(tree)
    if not keys:
        if has_kind(tree, ("manual",)):
            stats["oblig-generic"] += 1
        continue  # a foreign type's own Default: nothing of ours is involved
    name = o["callee_name"]
    if not site_ok(sp):
        cs = sp.get("callsite") or sp
        note("oblig-in-macro", cs, f"`{o['callee']}` needs `{o['ty']}: Default` inside a macro expansion: {sp.get('macro')}")
        continue
    if o["callee_workspace"]:
        note("oblig-workspace-generic", sp, f"`{o['callee']}` requires `{o['ty']}: Default`", callee=o["callee"])
        continue
    unsure = []
    _SITE["file"] = sp["file"]
    try:
        r = render(tree, unsure=unsure)
        b = buf(sp["file"])
        if o["form"] == "call" and name == "take" and o["callee"].endswith("mem::take"):
            csp = o["call"]["callee_span"]
            ctext = text(csp)
            if not ctext.endswith("take"):
                raise Manual(f"unexpected callee text `{ctext}`")
            new_callee = "core::mem::replace" if ctext == "take" else ctext[: -len("take")] + "replace"
            # insert the value before the closing parenthesis
            close = sp["hi"] - 1
            if b[close : close + 1] != b")":
                raise Manual("call does not end with `)`")
            k = close
            while k > 0 and b[k - 1 : k] in (b" ", b"\n", b"\t", b"\r"):
                k -= 1
            if b[k - 1 : k] == b",":
                ins = f" {r.text}"
            else:
                ins = f", {r.text}"
            edit(sp["file"], csp["lo"], csp["hi"], new_callee, "take")
            edit(sp["file"], k, k, ins, "take-arg")
            stats["take"] += 1
        elif o["form"] == "method" and name in ("unwrap_or_default", "or_default", "get_or_insert_default", "take"):
            msp = o["method"]["method_span"]
            if not site_ok(msp):
                raise Manual("method name is not in plain source")
            tail = b[msp["hi"] : sp["hi"]]
            if not re.fullmatch(rb"\s*\(\s*\)", tail):
                raise Manual(f"unexpected call tail {tail!r}")
            is_result = "result::Result" in o["callee"]
            if name == "unwrap_or_default":
                if r.cheap:
                    new = f"unwrap_or({r.text})"
                elif is_result:
                    new = f"unwrap_or_else(|_| {r.text})"
                elif r.fnpath:
                    new = f"unwrap_or_else({r.fnpath})"
                else:
                    new = f"unwrap_or_else(|| {r.text})"
            elif name == "or_default":
                if r.cheap:
                    new = f"or_insert({r.text})"
                elif r.fnpath:
                    new = f"or_insert_with({r.fnpath})"
                else:
                    new = f"or_insert_with(|| {r.text})"
            elif name == "get_or_insert_default":
                if r.fnpath:
                    new = f"get_or_insert_with({r.fnpath})"
                else:
                    new = f"get_or_insert_with(|| {r.text})"
            else:  # Cell::take / RefCell::take
                if not re.search(r"cell::(Cell|RefCell)(::)?<", o["callee"]):
                    raise Manual(f"`take` of `{o['callee']}`")
                new = f"replace({r.text})"
            edit(sp["file"], msp["lo"], sp["hi"], new, "method")
            stats["method"] += 1
        else:
            raise Manual(f"no rule for `{o['callee']}` ({o['form']})")
    except Manual as e:
        note("oblig-manual", sp, f"`{o['callee']}` needs `{o['ty']}: Default`: {e}")
        continue
    if unsure:
        note("path-unsure", sp, "a type is named by a path the tool could not confirm", paths=sorted(set(unsure)))


# ----------------------------------------------------------------------------------------------------------
# apply
# ----------------------------------------------------------------------------------------------------------
applied = collections.Counter()
changed_files = []
for path, es in sorted(edits.items()):
    if ONLY and not any(path.startswith(p) for p in ONLY):
        continue
    dels = impl_delete_ranges.get(path, [])
    keep = []
    seen = set()
    for lo, hi, new, tag in es:
        if (lo, hi, new) in seen:
            continue
        seen.add((lo, hi, new))
        if tag != "impl-delete" and any(dlo <= lo and hi <= dhi for dlo, dhi in dels):
            continue  # inside an impl that is deleted
        keep.append((lo, hi, new, tag))
    keep.sort(key=lambda e: (e[0], e[1]))
    ok = []
    last_hi = -1
    last = None
    for e in keep:
        if e[0] < last_hi or (last is not None and e[0] == last[0] and e[1] == last[1] and e[0] != e[1]):
            note("edit-conflict", {"file": path, "line": buf(path)[: e[0]].count(b"\n") + 1}, f"overlapping edits: {last[3]} and {e[3]}")
            continue
        ok.append(e)
        last_hi = max(last_hi, e[1])
        last = e
    b = buf(path)
    out = []
    pos = 0
    for lo, hi, new, tag in ok:
        out.append(b[pos:lo])
        out.append(new)
        pos = hi
        applied[tag] += 1
    out.append(b[pos:])
    nb = b"".join(out)
    if nb != b:
        changed_files.append(path)
        if args.apply:
            with open(os.path.join(ROOT, path), "wb") as f:
                f.write(nb)

summary = {
    "types": len(types),
    "types_live": sum(1 for t in types.values() if t.live),
    "types_with_ctor": sum(1 for t in types.values() if t.ctor),
    "ctor_kinds": collections.Counter(
        (t.ctor[0] + ":" + (t.ctor[1] if t.ctor[0] == "fn" else "delegate-or-variant")) if t.ctor else "manual" for t in types.values()
    ),
    "edits": dict(applied),
    "files_changed": len(changed_files),
    "report": {k: len(v) for k, v in report.items()},
    "oblig_generic_skipped": stats["oblig-generic"],
}
json.dump({"summary": summary, "report": report, "changed_files": changed_files}, open(args.report, "w"), indent=1, default=list)
print(json.dumps(summary, indent=1, default=dict))
