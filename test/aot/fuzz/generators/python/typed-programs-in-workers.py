#!/usr/bin/env python3
"""typed-programs-in-workers.py <seed>: a program of typed-programs.py that runs in the main thread and in two to four Workers at the same time.

All of them run the same compiled code at once, each in a heap of its own, so whatever the compiled code shares between threads is filled from several sides.
Each Worker sends what it would have printed to the main thread, which prints its own lines and whether each Worker agrees. As plain Bun, line by line."""
import os, runpy, sys
sys.argv = [sys.argv[0], sys.argv[1] if len(sys.argv) > 1 else "1", "workers"]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "typed-programs.py"), run_name="__main__")
