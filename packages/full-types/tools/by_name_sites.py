#!/usr/bin/env python3
"""by_name_sites.py <image map> [part of a path] [rows]

Which compiled functions still reach properties by name, counted in the code that was emitted and not in what was planned.

    BUN_JSC_aotMapFilePath=$PWD/app.map bun build --compile --aot app.ts --outfile app
    python3 by_name_sites.py app.map /react-reconciler/

A row is a compiled function of a file whose path has the part in it: the IR values with machine code that reach a property by name, those
that reach one at a fixed offset, the size of the function's code, its name and role, and the values by name by operation. The functions
with the most values by name come first. An inlined function counts where it was inlined. by_operation.py describes the image map."""
import collections, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from by_operation import columns_of, stretches_of

BY_NAME = r'Prop\w+|Private\w+|Super(Get|Set)|CallMethod|TryPutByIds'
BY_SLOT = r'(Get|Put)Slot\w*|GetDeferredClosureSlot'

if len(sys.argv) < 2:
    sys.exit(__doc__)
part = sys.argv[2] if len(sys.argv) > 2 else ''
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 40

found, function = [], None
for line in open(sys.argv[1], errors='replace'):
    if line.startswith('F\t'):
        function = columns_of(line)
    elif line.startswith('S\t') and part in function[10]:
        values = collections.defaultdict(set)
        for operation, value, _, _ in stretches_of(columns_of(line)):
            values[operation].add(value)
        by_name = {operation: len(values[operation]) for operation in sorted(values) if re.fullmatch(BY_NAME, operation)}
        by_slot = sum(len(values[operation]) for operation in values if re.fullmatch(BY_SLOT, operation))
        if by_name:
            found.append((-sum(by_name.values()), function[7], function[8], int(function[3]), by_slot, by_name))
for count, name, role, size, by_slot, by_name in sorted(found, key=lambda row: row[:5])[:rows]:
    print('%3d by name | %3d by slot | %6d B | %s (%s) %s' % (-count, by_slot, size, name, role, ' '.join('%s %d' % each for each in by_name.items())))
