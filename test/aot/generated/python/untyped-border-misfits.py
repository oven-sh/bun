#!/usr/bin/env python3
"""untyped-border-misfits.py <seed>: the programs of untyped-border.py whose values do not satisfy their types. As plain Bun, line by line."""
import os, runpy, sys
sys.argv = [sys.argv[0], sys.argv[1] if len(sys.argv) > 1 else "1", "misfits"]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "untyped-border.py"), run_name="__main__")
