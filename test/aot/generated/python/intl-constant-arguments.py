#!/usr/bin/env python3
"""intl-constant-arguments.py <seed>: Intl formatters and toLocaleString calls with constant arguments format from a pattern made at build time. Each is compared, in the program, with a twin whose arguments the compiler cannot see; a program prints the differences and a count.
0: odd spellings of locales, options and time zones, and odd uses of a formatter. 1: formatters that travel, options changed in ways a compiler may miss, Intl shadowed. 2: toLocaleString on every kind of receiver. 3: the time zone changes while the program runs. 4: nine threads on the same call sites. 5: many formatters and collections. 6: no time zone option. 7 to 60: named time zones at every change of offset. 61 to 120: numbers with fractions.
As plain Bun, line by line."""
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
