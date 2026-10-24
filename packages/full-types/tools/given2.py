#!/usr/bin/env python3
"""given2.py <a formed text (module_form8, --opaque=index)> <out .ts> --mode=modules|ambient|any [--live=Name,Name] [--doors=keep|any]: HOW MUCH IS HELD AT THE DOORS: WHAT OTHER CODE MAKES MUST BE VIEWED, NEVER COPIED.
THE ENGINE's RULE (AOTTypedObject.cpp coerce(), :7600..): an object not made by compiled code that enters an ANNOTATED place: the type admits foreign objects: it is kept as it is; else a plain object is COPIED into the layout (another identity) or refused. A TYPE DECLARED IN AN AMBIENT CONTEXT HAS NO LAYOUT: IT IS WHAT IS GIVEN. module_form made ALL shapes non-ambient: right for what is born here, wrong for what is given. MODEL, RUN: (eight answers; annotation: that very refusal; ambient | any: as plain).
 modules: the two doors of the modules alone: `React: RR.ReactModule` | `Scheduler: RR.SchedulerModule` -> `: any` (the shared internals and the scheduler's functions are then any by inference)
 ambient: modules, AND every GIVEN interface goes to a `declare namespace RR { }` block of its own (one name, two blocks: they merge)
 any    : modules, AND every GIVEN interface becomes `type Name = any;`: nearly sure to answer
given1.py WITH TWO THINGS (03:31): --doors=keep (THE DEFAULT) LEAVES THE BODY ALONE: `React: RR.ReactModule` | `Scheduler: RR.SchedulerModule` stay as typed.cts has them: both interfaces are GIVEN, so nothing is converted at those two lines ("what changes a type belongs in typed.cts; what sorts the shapes may stay behind the form"); --doors=any is given1's way. AND A FINAL NEWLINE IS WRITTEN, as module_form writes one. --mode=modules wants --doors=any.
GIVEN = an interface of the shapes whose own comments name no birth ("birth"), AND those born here that others make too: RefObject ReactContext Transition ReactElement. --live= takes names out of GIVEN."""
import re, sys
args = [a for a in sys.argv[1:] if not a.startswith("--")]; opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--"))
mode = opts["mode"]; live = set(filter(None, opts.get("live", "").split(","))); L = open(args[0]).read().split("\n")
n = 0
for i, l in enumerate(L if opts.get("doors", "keep") == "any" else []):
    l2 = re.sub(r"\b(React: )RR\.ReactModule( = )", r"\1any\2", l); l2 = re.sub(r"\b(Scheduler: )RR\.SchedulerModule( = )", r"\1any\2", l2)
    if l2 != l: L[i] = l2; n += 1
if n < 1 and opts.get("doors", "keep") == "any": sys.exit("given2: the modules' doors are not found")
BOTH = {"RefObject", "ReactContext", "Transition", "ReactElement"}
out = []; i = 0; given = []; born = []; ambient = []
while i < len(L):
    l = L[i]; m = re.match(r"  export interface ([\w$]+)", l)
    if not m or mode == "modules": out.append(l); i += 1; continue
    j = i
    if not re.search(r"\}\s*(//.*)?$", l) or l.count("{") > l.count("}"):
        while not re.match(r"  \}", L[j]) or j == i: j += 1
    k = len(out)
    while k > 0 and re.match(r"\s*(/\*\*|\*|//)", out[k - 1]): k -= 1
    said = "\n".join(out[k:] + L[i : j + 1]); name = m.group(1)
    is_given = (name in BOTH or not re.search(r"\bbirths?\b", said) or re.search(r"\bNO BIRTH\b|no birth", said)) and name not in live
    if not is_given: born.append(name); out += L[i : j + 1]
    else:
        given.append(name)
        if mode == "any":
            g = re.match(r"  export interface [\w$]+(<[^>{]*>)?", l).group(1) or ""
            out.append("  export type %s%s = any;" % (name, g))
        else: ambient += [re.sub(r"^  export interface", "  interface", L[i])] + L[i + 1 : j + 1]
    i = j + 1
if ambient: out += ["declare namespace RR {"] + ambient + ["}"]
open(args[1], "w").write("\n".join(out).rstrip("\n") + "\n"); print("given2: mode %s: the modules' doors %d · born here %d · GIVEN %d: %s" % (mode, n, len(born), len(given), " ".join(given)))
