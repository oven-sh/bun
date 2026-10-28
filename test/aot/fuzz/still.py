#!/usr/bin/env python3
"""still.py <config.json> <form> <mode> <verdict> [--detail <regex>] [--say] <program file>: exits with 0 if the program, built in that form and run in that
mode, still gets that verdict from the farm's judge. For reduce.py. With --say it prints every verdict and what the executable printed."""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import farm as farm_module, producers

arguments = sys.argv[1:]
detail = None
if "--detail" in arguments:
    at = arguments.index("--detail"); detail = arguments[at + 1]; del arguments[at:at + 2]
say = "--say" in arguments
if say: arguments.remove("--say")
config, form, mode, verdict, path = arguments
farm = farm_module.Farm(config)
folder = os.path.dirname(os.path.abspath(path))
others = {}
program = producers.Program("by-hand", 1, {}, os.path.basename(path), may_be_refused=False, reference_may_fail=True)
reference = farm.reference(folder, program)
if say: print("plain Bun: exit %s\n%s%s" % (reference[0], reference[1], reference[2][-2000:]))
if reference[0] is None or farm_module.died(reference[0], reference[1] + reference[2]): sys.exit(2)
good = False
for got_mode, got, got_detail, output in farm.one_form(folder, program, reference, form, farm.forms[form], [mode]):
    if say: print("%s %s: %s | %s\n%s" % (form, got_mode, got, got_detail, output[-6000:]))
    if got == verdict and (not detail or re.search(detail, got_detail + "\n" + output)): good = True
sys.exit(0 if good else 1)
