#!/usr/bin/env python3
"""by_operation.py <period> <perf.data> <perf map> <image map> [rows]

Where the instructions of compiled functions go, by the IR operation whose machine code they fell into. Linux, with perf.

    BUN_JSC_aotMapFilePath=$PWD/app.map bun build --compile --aot app.ts --outfile app
    BUN_JSC_useAOTPerfMap=1 perf record -e instructions:u -c 500009 -o app.perf ./app
    python3 by_operation.py 500009 app.perf /tmp/perf-<pid of app>.map app.map

<period> is the number behind `perf record -c`. Prints two tables in G instructions: by kind of operation, then the heaviest operations.
An operation whose code calls a stub or the run time is charged its own call sequence alone: what the callee executes is in the rows
of stubs.py and of the run time.

The lines of the image map that are read here, with tabs between the columns:
    F  a compiled function: its number, its offset and size in the image's code, .. name, role, .. file
    S  behind an F line: five columns for each stretch of the function's code: operation, IR value, representation of the first
       operand, offset, size. `+` behind the operation: inlined. `*`: in a loop.
    P  a function's number, then three columns for each stretch that was outlined: offset, size, body. A call took its place, and
       that call is what the stretch's first operation is charged. A body that several functions share is a row of stubs.py.
    E  a function's number, then two columns for each entry point that outlining moved: offset, bytes of padding put before it.
    C  the offset of a copy of the stubs
The offsets in S, P and E count in the function as it was before outlining."""
import bisect, collections, platform, re, subprocess, sys

# The first kind that fits counts.
KINDS = [
    ('accesses by name', r'Prop\w+|Elem\w+|Private\w+|Super(Get|Set)|CallMethod|TryPut\w+|Define\w+|TryDefineLiveBinding|TryReExportFields|GetByValWithThis|GetOwn\w+'
                         r'|EnumeratorGetByVal|CopyDataProperties|CopyObject|TryCopyFields|ScopeHasBinding'),
    ('accesses by slot', r'(Get|Put)(Slot\w*|EnvironmentField|ModuleVariable|InternalField|TypedArrayElement|ContiguousIndex|DoubleIndex)|(Get|Put|Has)ArrayElement'
                         r'|(Get|Set)(GlobalBinding|MappedArgument)|Get(DeferredClosureSlot|EncodedModuleVariable|Capture|BuiltinValue|RequiredValue|StringCodeUnit|Argument|MyArgumentByVal)'
                         r'|Get(Array|TypedArray|String|Rest)Length'),
    ('tests and guards', r'TypeTest|ShapeTest|SwitchOnShape|TestAndBranch|AllGuards|Check|CheckInitialized|AssumeType|NarrowByField|ReportMismatch|BelongsToInstance'
                         r'|Require(Object|ObjectCoercible|AttachedTypedArray)|ReturnsToResultTest|Is[A-Z]\w*|Are[A-Z]\w*|Has(?!InPrototypeChain|ByKeyParts)[A-Z]\w*'),
    ('checks of a validating build', r'Validate\w+'),
    ('calls and returns', r'Call\w*|TryCallInline|Construct\w*|SuperConstruct\w*|ResolveCallTarget|Return\w*|Results|ResultAt'),
    ('allocations', r'New\w+|Create\w+|MaterializeEnvironment|Data|CloneAs'),
    ('representations', r'Box|Unbox|Decode|Compress|Upcast|IntegerToNumber|NumberToInteger|WidenInteger|NarrowInteger|To[A-Z]\w*'),
    ('control', r'Jump|Branch|Switch|SwitchString|LoopHint|Throw\w*|Rethrow|Unreachable|Catch\w+'),
    ('no operation (entry, exit, moves between blocks)', r'-'),
]
OTHER_KIND = 'everything else (arithmetic, compares, strings, ..)'
NEAR_CALL_SIZE = 4 if platform.machine() in ('aarch64', 'arm64') else 5


def kind_of(label):
    operation = label.split('.')[0]
    return next((kind for kind, pattern in KINDS if re.fullmatch(pattern, operation)), OTHER_KIND)


def columns_of(line):
    return line.rstrip('\n').split('\t')


def stretches_of(columns):
    """Takes the columns of an S line. Returns (operation, IR value, offset, size) for each stretch, in the order of the code.
    The name of a built-in stays behind its operation: `CallBuiltin.ArrayPrototypePush/1`."""
    return [(columns[i].rstrip('*+'), columns[i + 1], int(columns[i + 3]), int(columns[i + 4])) for i in range(1, len(columns) - 4, 5)]


def address_of_code(perf_map, image_map):
    copies = (re.match(r'([0-9a-f]+) [0-9a-f]+ \(stubs', line) for line in open(perf_map, errors='replace'))
    addresses = sorted(int(copy.group(1), 16) for copy in copies if copy)
    offsets = sorted(int(columns[1]) for columns in map(columns_of, open(image_map, errors='replace')) if columns[0] == 'C')
    bases = {address - offset for address, offset in zip(addresses, offsets)}
    if len(addresses) != len(offsets) or len(bases) != 1:
        sys.exit('by_operation.py: %s and %s are not of the same build: they disagree about the copies of the stubs' % (perf_map, image_map))
    return bases.pop()


def offset_before_outlining(offset, edits):
    """edits: (offset before outlining, bytes that outlining took out there) in the order of the code. Padding took out less than nothing."""
    for at, removed in edits:
        if offset < at:
            break
        if removed < 0:
            offset = max(at, offset + removed)
        elif offset >= at + NEAR_CALL_SIZE:
            offset += removed
    return offset


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    period, (data, perf_map, image_map) = int(sys.argv[1]), sys.argv[2:5]
    rows = int(sys.argv[5]) if len(sys.argv) > 5 else 60

    functions = sorted((int(columns[2]), int(columns[3]), int(columns[1])) for columns in map(columns_of, open(image_map, errors='replace')) if columns[0] == 'F')
    starts = [start for start, _, _ in functions]
    sizes = {number: size for _, size, number in functions}
    code = address_of_code(perf_map, image_map)

    sampled, total, inside = collections.defaultdict(list), 0, 0
    script = subprocess.run(['perf', 'script', '-i', data, '-F', 'ip', '-G'], capture_output=True, text=True, errors='replace')
    for address in script.stdout.split():
        total += 1
        offset = int(address, 16) - code
        index = bisect.bisect_right(starts, offset) - 1
        if index >= 0 and offset < starts[index] + functions[index][1]:
            sampled[functions[index][2]].append(offset - starts[index])
            inside += 1
    if not total:
        sys.exit('by_operation.py: perf script printed no sample: ' + script.stderr[-300:])

    stretches, edits, current = {}, collections.defaultdict(list), None
    for line in open(image_map, errors='replace'):
        letter = line[:2]
        if letter == 'F\t':
            current = int(line.split('\t', 2)[1])
        elif letter == 'S\t' and current in sampled:
            stretches[current] = stretches_of(columns_of(line))
        elif letter == 'P\t':
            columns = columns_of(line)
            edits[int(columns[1])] += [(int(columns[i]), int(columns[i + 1]) - NEAR_CALL_SIZE) for i in range(2, len(columns) - 2, 3)]
        elif letter == 'E\t':
            columns = columns_of(line)
            edits[int(columns[1])] += [(int(columns[i]), -int(columns[i + 1])) for i in range(2, len(columns) - 1, 2)]

    by_label, unmapped = collections.Counter(), 0
    for number, offsets in sampled.items():
        ranges, changes = stretches.get(number), sorted(edits.get(number, ()))
        end = ranges[-1][2] + ranges[-1][3] if ranges else 0
        if not ranges or changes and end - sum(removed for _, removed in changes) != sizes[number]:
            unmapped += len(offsets)
            continue
        range_starts = [start for _, _, start, _ in ranges]
        for offset in offsets:
            offset = offset_before_outlining(offset, changes)
            by_label[ranges[bisect.bisect_right(range_starts, offset) - 1][0] if offset < end else '-'] += 1

    giga = lambda samples: samples * period / 1e9
    share = lambda samples: 100 * samples / max(inside, 1)
    print('%d samples = %.1f G; in compiled functions %.1f G; not mapped to an operation %.2f G' % (total, giga(total), giga(inside), giga(unmapped)))
    by_kind = collections.Counter()
    for label, samples in by_label.items():
        by_kind[kind_of(label)] += samples
    for title, counts in (('kind of operation', by_kind.most_common()), ('operation', by_label.most_common(rows))):
        print('\n| %s | G | share of compiled code |\n|---|---:|---:|' % title)
        for name, samples in counts:
            print('| %s | %.2f | %.1f%% |' % (name, giga(samples), share(samples)))


if __name__ == '__main__':
    main()
