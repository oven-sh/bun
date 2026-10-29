#!/usr/bin/env python3
"""Prints the counters that counts.so left in a file, divided by a number of calls. usage: countsdump.py <file> <calls>"""
import struct, sys
names = ["futexWake", "futexWait", "schedYield", "eventfdWrite", "eventfdRead"]
data = open(sys.argv[1], "rb").read(len(names) * 3 * 8)
vals = struct.unpack("<%dQ" % (len(names) * 3), data)
calls = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
out = {}
for i, name in enumerate(names):
    main, pool, other = vals[i * 3:i * 3 + 3]
    out[name] = {"loop": round(main / calls, 2), "pool": round(pool / calls, 2), "other": round(other / calls, 2)}
print(out)
