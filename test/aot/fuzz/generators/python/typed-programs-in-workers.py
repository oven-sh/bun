#!/usr/bin/env python3
"""typed-programs-in-workers.py <seed>: A program of typed-programs.py that runs in the main thread and in two to four
Workers at the same time. All of them run the same compiled code, each with its own heap.
"""
import os, runpy, sys
sys.argv = [sys.argv[0], sys.argv[1] if len(sys.argv) > 1 else "1", "workers"]
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "typed-programs.py"), run_name="__main__")
