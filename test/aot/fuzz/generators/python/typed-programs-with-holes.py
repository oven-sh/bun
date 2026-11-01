#!/usr/bin/env python3
"""typed-programs-with-holes.py <seed>: The programs of typed-programs.py, extended with holes in TypeScript's type
system: a variable that a closure reads before it is assigned, an element past the end of an array, and so on. The
build may reject them.
"""
import os, runpy, sys
sys.argv = [sys.argv[0], sys.argv[1] if len(sys.argv) > 1 else "1", "holes"]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "typed-programs.py"), run_name="__main__")
