#!/usr/bin/env python3
"""Generates tarballs + destination setups for differential testing of Bun.Archive#extract.

Each case is a directory: case/<name>/{a.tar, setup.sh?}. setup.sh runs with cwd = the
case's scratch dir and prepares ./out (the destination) before extraction.
"""
import io, os, sys, tarfile, shutil

ROOT = sys.argv[1]
shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT)

def F(name, data=b"data", mode=0o644): return ("f", name, data, mode)
def D(name, mode=0o755): return ("d", name, None, mode)
def L(name, target): return ("l", name, target, 0o777)
def H(name, target): return ("h", name, target, 0o644)
def P(name): return ("p", name, None, 0o644)

def case(name, items, setup=None, fmt=tarfile.PAX_FORMAT):
    d = os.path.join(ROOT, name)
    os.makedirs(d)
    with tarfile.open(os.path.join(d, "a.tar"), "w", format=fmt) as t:
        for kind, n, extra, mode in items:
            i = tarfile.TarInfo(n)
            i.mode = mode
            if kind == "d": i.type = tarfile.DIRTYPE; t.addfile(i)
            elif kind == "l": i.type = tarfile.SYMTYPE; i.linkname = extra; t.addfile(i)
            elif kind == "h": i.type = tarfile.LNKTYPE; i.linkname = extra; t.addfile(i)
            elif kind == "p": i.type = tarfile.FIFOTYPE; t.addfile(i)
            else: i.size = len(extra); t.addfile(i, io.BytesIO(extra))
    if setup:
        with open(os.path.join(d, "setup.sh"), "w") as f:
            f.write("set -e\n" + setup + "\n")

# --- plain shapes
case("flat", [F("a.txt"), F("b.txt"), F("c.txt")])
case("nested-implicit", [F("a/b/c/f1"), F("a/b/c/f2"), F("a/b/d/f3"), F("a/e/f4"), F("g/f5")])
case("nested-explicit", [D("a/"), D("a/b/"), F("a/b/f1"), D("a/c/"), F("a/c/f2"), D("empty/")])
case("explicit-no-slash", [D("a"), D("a/b"), F("a/b/f1")])
case("dir-after-file", [F("a/b/f1"), D("a/"), D("a/b/")])
case("dup-dir-dotslash", [D("./a/"), D("a/"), F("./a/f1"), F("a/f2")])
case("dot-entries", [D("./"), F("./f1"), F("a/./f2"), F("a/b/../f3")])
case("unsorted", [F("a/x/1"), F("b/y/2"), F("a/x/3"), F("b/z/4"), F("a/w/5"), F("c/6"), F("a/x/7")])
case("deep-140", [F("/".join(["d"] * 140) + "/f"), F("/".join(["d"] * 140) + "/g"), F("/".join(["d"] * 139) + "/h")])
case("long-name-200", [F("a/" + "n" * 200 + "/f"), F("n" * 200)])
case("long-name-300-parent", [F("x" * 300 + "/f"), F("ok")])
case("long-name-300-leaf", [F("a/" + "x" * 300), F("ok")])
case("long-name-300-dir", [D("a/" + "x" * 300 + "/"), F("ok")])
case("overwrite-twice", [F("a/f", b"one"), F("a/f", b"two")])
case("empty-file-and-modes", [F("z", b""), F("exec.sh", b"#!/bin/sh\n", 0o755), F("ro", b"r", 0o444), F("suid", b"s", 0o4755)])
# --- directory modes
case("dir-mode-000-empty", [D("d/", 0o000), F("ok")])
case("dir-mode-000-child", [D("d/", 0o000), F("d/f"), F("ok")])
case("dir-mode-311-child", [D("d/", 0o311), F("d/f"), D("d/sub/"), F("d/sub/g")])
case("dir-mode-555-child", [D("d/", 0o555), F("d/f"), F("ok")])
case("dir-mode-700-nested", [D("d/", 0o700), D("d/e/", 0o700), F("d/e/f")])
# --- conflicts inside one archive
case("file-then-child", [F("a", b"file"), F("a/b", b"child"), F("ok")])
case("file-then-dir", [F("a", b"file"), D("a/"), F("ok")])
case("dir-then-file-same-name", [D("a/"), F("a", b"file"), F("ok")])
case("child-then-file", [F("a/b", b"child"), F("a", b"file"), F("ok")])
# --- symlinks in the archive
case("symlink-safe", [F("real/f"), L("link", "real"), L("real/self", "f")])
case("symlink-unsafe-abs", [L("x/y/bad", "/etc"), F("ok")])
case("symlink-unsafe-dotdot", [L("x/bad", "../../etc"), F("ok")])
case("symlink-then-write-through", [L("d", "."), F("d/f"), F("ok")])
case("symlink-chain-same-archive", [L("d1", "."), L("d1/d2/up", "../.."), F("d1/d2/up/escape")])
case("symlink-over-file", [F("name", b"file"), L("name", "other"), F("other")])
case("symlink-dup", [L("l", "a"), L("l", "b"), F("a"), F("b")])
case("symlink-in-new-dirs", [L("p/q/r/link", "target"), F("p/q/r/target")])
case("hardlink", [F("a/orig", b"orig"), H("a/hard", "a/orig")])
case("fifo", [P("p/q/fifo"), F("ok")])
# --- pre-existing destination content (no symlinks: must be identical)
case("pre-dirs", [F("a/b/f1"), D("a/"), F("c/f2")], "mkdir -p out/a/b out/c")
case("pre-files", [F("a/f", b"new"), F("top", b"new")], "mkdir -p out/a && echo old > out/a/f && echo old > out/top")
case("pre-file-in-the-way", [F("a/b/f"), F("ok")], "mkdir -p out && echo file > out/a")
case("pre-file-in-the-way-deep", [F("a/b/c/f"), F("ok")], "mkdir -p out/a && echo file > out/a/b")
case("pre-dir-at-file-name", [F("a", b"file"), F("ok")], "mkdir -p out/a")
case("pre-file-at-dir-name", [D("a/"), F("ok")], "mkdir -p out && echo file > out/a")
case("pre-ro-file", [F("f", b"new")], "mkdir -p out && echo old > out/f && chmod 444 out/f")
case("pre-dir-mode-311", [F("d/f"), F("d/sub/g")], "mkdir -p out/d && chmod 311 out/d")
case("pre-dir-mode-555", [F("d/f"), F("ok")], "mkdir -p out/d && chmod 555 out/d")
case("pre-dir-mode-000", [F("d/f"), F("ok")], "mkdir -p out/d && chmod 000 out/d")
case("dest-readonly", [F("a/f"), F("top")], "mkdir -p out && chmod 555 out")
case("dest-readonly-direntry", [D("d/"), F("top")], "mkdir -p out && chmod 555 out")
case("dest-is-file", [F("f")], "echo file > out")
# --- pre-existing symlinks (EXPECTED to differ: this is the bug)
case("XPRE-leaf-symlink", [F("cfg", b"OVERWRITTEN")], "mkdir -p out victim && echo ORIGINAL > victim/f.txt && ln -s ../victim/f.txt out/cfg")
case("XPRE-leaf-symlink-dangling", [F("cfg", b"NEW")], "mkdir -p out && ln -s ../nowhere out/cfg")
case("XPRE-parent-symlink-outside", [F("shared/f", b"OUTSIDE"), F("inside", b"INSIDE")], "mkdir -p out victim && ln -s ../victim out/shared")
case("XPRE-parent-symlink-inside", [F("link/f", b"F"), F("ok")], "mkdir -p out/real && ln -s real out/link")
case("XPRE-parent-symlink-deep", [F("a/b/c/f", b"F"), F("ok")], "mkdir -p out/a victim && ln -s ../../victim out/a/b")
case("XPRE-dir-entry-over-symlink", [D("d/"), F("d/f"), F("ok")], "mkdir -p out victim && ln -s ../victim out/d")
case("XPRE-symlink-entry-under-symlink", [L("d/link", "x"), F("ok")], "mkdir -p out victim && ln -s ../victim out/d")
case("XPRE-leaf-symlink-to-dir", [F("name", b"F")], "mkdir -p out/real && ln -s real out/name")
# --- directory modes when the parent has no entry, and symlinks made by the same archive
case("implicit-parent-dir-555-child", [D("a/b/", 0o555), F("a/b/f"), F("ok")])
case("implicit-parent-dir-700", [D("x/y/", 0o700), F("ok")])
case("implicit-parent-dir-000", [D("x/y/", 0o000), F("ok")])
case("explicit-parent-dir-555-child", [D("a/", 0o755), D("a/b/", 0o555), F("a/b/f"), F("ok")])
case("implicit-parent-after-sibling", [F("a/z"), D("a/b/", 0o555), F("a/b/f")])
case("dir-entry-twice-modes", [D("d/", 0o700), D("d/", 0o755), F("d/f")])
case("symlink-then-dir-same-name", [L("d", "real"), D("d/"), F("d/f"), F("real/g")])
case("symlink-then-file-same-name", [L("n", "x"), F("n", b"file"), F("x", b"x")])
case("file-then-symlink-same-name", [F("n", b"file"), L("n", "x"), F("x", b"x")])
case("symlink-to-dir-then-member", [D("releases/"), D("releases/v1/"), L("current", "releases/v1"), F("current/config", b"cfg")])
case("symlink-parent-chain", [L("a", "b"), L("b", "c"), D("c/"), F("a/f")])
case("nested-dir-300-then-child", [D("a/" + "x" * 300 + "/"), F("a/" + "x" * 300 + "/f"), F("ok")])
case("dir-under-file", [F("a", b"file"), D("a/b/"), F("ok")])
case("pre-dir-entry-under-file", [D("a/b/"), F("ok")], "mkdir -p out && echo file > out/a")
case("XPRE-symlink-dangling-parent", [F("d/f"), F("ok")], "mkdir -p out && ln -s nowhere out/d")
case("XPRE-symlink-to-file-parent", [F("d/f"), F("ok")], "mkdir -p out && echo file > out/target && ln -s target out/d")
print("cases:", len(os.listdir(ROOT)))
