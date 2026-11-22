#!/usr/bin/env python3
"""intl-constant-arguments.py <seed>: Intl formatters and toLocaleString calls with constant arguments format from a
pattern computed at build time. Each is compared, inside the program, with a twin whose arguments the compiler cannot
see.
"""
import json, os, re, runpy, sys
seed = int(sys.argv[1]); here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "intl-constant-arguments")
def run(name, *words):
    sys.argv = [name] + [str(word) for word in words]
    runpy.run_path(os.path.join(here, name), run_name="__main__")
if seed == 0: run("scenes.py")
elif seed == 1: run("flows.py")
elif seed in (2, 3, 4, 5): sys.stdout.write(open(os.path.join(here, ("receivers.ts", "zone_changes.ts", "workers.ts", "many_formatters.ts")[seed - 2])).read())
elif seed == 6: run("zones.py", "default")
elif seed <= 60: run("zones.py", seed - 7, 54)
else: run("fractions.py", seed - 61, 60)
