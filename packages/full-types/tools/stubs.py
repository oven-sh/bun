#!/usr/bin/env python3
"""stubs.py <perf.data> <perf map> <image map> [rows]

The samples that fell into the stubs of compiled code, by stub, as shares of all samples. Linux, with perf.
by_operation.py says how the three files are made. Variants of a stub that differ in a number or in the registers they keep are one row."""
import os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'test', 'aot', 'servers', 'measure'))
import layers

if len(sys.argv) < 4:
    sys.exit(__doc__)
data, perf_map, image_map = sys.argv[1:4]
rows = int(sys.argv[4]) if len(sys.argv) > 4 else 40

script = subprocess.run(['perf', 'script', '-i', data, '-F', 'ip,sym', '-G'], capture_output=True, text=True, errors='replace')
total, addresses = 0, []
for line in script.stdout.split('\n'):
    fields = line.split(None, 1)
    if fields:
        total += 1
        if len(fields) > 1 and fields[1].startswith('(stub'):
            addresses.append(int(fields[0], 16))
if not total:
    sys.exit('stubs.py: perf script printed no sample: ' + script.stderr[-300:])
print('%d samples, %d in stubs (%.1f%%)' % (total, len(addresses), 100 * len(addresses) / total))
for name, samples in layers.count_stubs(addresses, perf_map, image_map).most_common(rows):
    print('%6.2f%%  %s' % (100 * samples / total, name))
