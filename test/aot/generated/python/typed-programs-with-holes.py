#!/usr/bin/env python3
"""typed-programs-with-holes.py <seed>: the programs of typed-programs.py, which also use the holes in TypeScript's type system. MAY BE REFUSED.

A variable that a closure reads before it is assigned, an element beyond the end of an array, an absent key of a Record, a hole of a sparse or lengthened
array, a pattern longer than its array, a parameter that a caller leaves out: TypeScript takes each for its declared type, and each is undefined when
the program runs. Typed code goes on to compute with them. As plain Bun, line by line, or the line says that a TypeError was thrown. Never another value."""
import os, runpy, sys
sys.argv = [sys.argv[0], sys.argv[1] if len(sys.argv) > 1 else "1", "holes"]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "typed-programs.py"), run_name="__main__")
