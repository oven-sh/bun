#!/usr/bin/env python3
"""table.py <rows.tsv> [<rows.tsv> ..]: the rows that measure.py wrote, as Markdown tables: one table per metric and number of cores, a line per test, a column per column.
Where a test and column occur more than once the last row counts. The column named in $BASE (aot) is compared with every other: its requests a second as a percentage above or below, and in how many of the fresh starts, paired in the order
in which they were made, the difference had that sign. $COMPARE=no leaves that out: columns that lived side by side in groups (measure.py: $TOGETHER) are compared within a group: pairs.py.
Rows made with $LAYERS=yes are followed by one table per test: cycles and user instructions per request by the layer that owns the code, and $BASE minus every other column. The three layers of compiled code
(application, stubs, modules) stand against one layer of a JIT build, of Go and of Rust, so differences are taken on their sum. The largest difference of a column is bold. A stripped executable has all its
native code in one layer and gets no differences."""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'servers', 'measure'))
import layers

ORDER = ['aot', 'aot.previous', 'released', 'jit', 'node', 'aot.2', 'go', 'rust']
TESTS = ['plaintext', 'json', 'db'] + ['queries%d' % n for n in (1, 5, 10, 15, 20)] + ['fortunes'] + ['updates%d' % n for n in (1, 5, 10, 15, 20)] + ['product', 'quote']
NAMES = {'aot': '--aot', 'aot.previous': '--aot, previous Bun', 'released': 'Bun 1.4.3', 'jit': 'our JIT build', 'node': 'Node', 'go': 'Go', 'rust': 'Rust',
         'aot.2': '--aot again, beside Go and Rust'}
METRICS = [('requests_a_second', 'Requests a second', '%.0f', 1), ('early_requests_a_second', 'Requests a second over the first 10,000 requests of a fresh process', '%.0f', 1), ('p50_us', 'Latency p50 in the closed loop, us', '%.0f', -1), ('p99_us', 'Latency p99 in the closed loop, us', '%.0f', -1),
           ('paced_p50_us', 'Latency p50 at the fixed rate, us', '%.0f', -1), ('paced_p99_us', 'Latency p99 at the fixed rate, us', '%.0f', -1), ('cpu_us', 'CPU a request, us (user + kernel, all threads)', '%.2f', -1),
           ('kernel_us', 'of which in the kernel, us', '%.2f', -1), ('instructions', 'User instructions a request', '%.0f', -1), ('cycles', 'User cycles a request', '%.0f', -1), ('ic_cache_fill_l2', 'Lines of code the first-level cache took from the L2, a request (EVENTS=ic_cache_fill_l2)', '%.0f', -1), ('l2_cache_req_stat.ic_fill_miss', 'Lines of code that came from beyond the L2, a request', '%.0f', -1), ('counted_requests_a_second', 'Requests a second while the hardware counters are on (what counting costs)', '%.0f', 1), ('postgres_us', "Postgres' CPU a request, us", '%.1f', -1),
           ('ready_rss_mb', 'RSS at ready, MB (all processes)', '%.1f', -1), ('peak_rss_mb', 'Peak RSS, MB (all processes)', '%.1f', -1), ('private_mb', 'Private memory at its highest, MB (all processes)', '%.1f', -1),
           ('first_answer_ms', 'Time to the first answer, ms', '%.1f', -1), ('file_mb', 'What is deployed, MB', '%.1f', -1)]
rows = {}
for path in sys.argv[1:]:
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'ROW':
            rows[(int(f[3]), f[1], f[2])] = dict(x.split('=', 1) for x in f[4:])
base = os.environ.get('BASE', 'aot')
for cores in sorted(set(k[0] for k in rows)):
    columns = [c for c in ORDER if any(k[0] == cores and k[2] == c for k in rows)]
    tests = [t for t in TESTS + list(dict.fromkeys(k[1] for k in rows if k[1] not in TESTS)) if any(k[0] == cores and k[1] == t for k in rows)]
    print('\n## %d core%s for the server\n' % (cores, '' if cores == 1 else 's'))
    for metric, title, form, better in METRICS:
        if not any(metric in r for r in rows.values()):
            continue
        print('**%s**\n' % title)
        compare = metric == 'requests_a_second' and os.environ.get('COMPARE', 'yes') == 'yes'
        print('| test | ' + ' | '.join(NAMES[c] for c in columns) + ' |' + (''.join(' %s against %s |' % (NAMES[base], NAMES[c]) for c in columns if c != base) if compare else ''))
        print('|---|' + '---:|' * (len(columns) + (len(columns) - 1 if compare else 0)))
        for t in tests:
            cells, against = [], []
            mine = rows.get((cores, t, base), {})
            for c in columns:
                r = rows.get((cores, t, c))
                if r is None:
                    cells.append('')
                elif 'failed' in r:
                    cells.append('FAILED: ' + r['failed'])
                elif r.get('void') == 'yes':
                    cells.append('void: other work ran on its cores')
                elif metric not in r:
                    cells.append('')
                else:
                    note = ''
                    if compare and r.get('limit', 'server') != 'server':
                        note = ' (limit: %s)' % r['limit']
                    elif compare and float(r.get('server_busy', 1)) < 0.9:
                        note = ' (its cores were only %.2f busy)' % float(r['server_busy'])
                    cells.append('{:,}'.format(float(form % float(r[metric]))).rstrip('0').rstrip('.') + note if form != '%.0f' else '{:,.0f}'.format(float(r[metric])) + note)
                if compare and c != base:
                    if not (r and metric in r and metric in mine) or 'yes' in (r.get('void'), mine.get('void')):
                        against.append('')
                        continue
                    percent = (float(mine[metric]) / float(r[metric]) - 1) * 100
                    pairs = list(zip(mine.get('start_' + metric, '').split(), r.get('start_' + metric, '').split()))
                    same = sum(1 for x, y in pairs if (float(x) > float(y)) == (percent > 0))
                    against.append('%+.1f%% (%d of %d)' % (percent, same, len(pairs)))
            print('| %s | ' % t + ' | '.join(cells + against) + ' |')
        print()

COMPILED = ('application', 'stubs', 'modules')
for (cores, test, column), row in rows.items():
    if column != base or 'layers_cycles' not in row:
        continue
    for event in ('cycles', 'instructions'):
        cells = dict((c, dict((k, int(v)) for k, v in (x.split(':') for x in rows[cores, test, c]['layers_' + event].split()))) for c in ORDER if 'layers_' + event in rows.get((cores, test, c), {}))
        others = [c for c in cells if c != base and 'engine' in cells[c]]

        def value(c, layer):
            return sum(v for k, v in cells[c].items() if k == layer or layer == 'compiled' and k in COMPILED or layer == 'all')
        names = ['compiled'] + layers.LAYERS + ['kernel']
        largest = dict((c, max(value(base, k) - value(c, k) for k in names if k not in COMPILED)) for c in others)
        print('**%s, %d core%s: %s per request by layer**\n' % (test, cores, '' if cores == 1 else 's', 'cycles' if event == 'cycles' else 'user instructions'))
        print('| layer | ' + ' | '.join(NAMES[c] for c in cells) + ' |' + ''.join(' %s minus %s |' % (NAMES[base], NAMES[c]) for c in others))
        print('|---|' + '---:|' * (len(cells) + len(others)))
        for layer in names + ['all']:
            if not any(value(c, layer) for c in cells):
                continue
            title = 'all compiled code | JIT code | the program in Go, in Rust' if layer == 'compiled' else layers.TITLES.get(layer, layer)
            differences = ['' if layer in COMPILED else ('**%s**' if layer != 'all' and value(base, layer) - value(c, layer) == largest[c] else '%s') % '{:+,}'.format(value(base, layer) - value(c, layer)) for c in others]
            print('| %s | ' % title.replace('|', '\\|') + ' | '.join(['{:,}'.format(value(c, layer)) if value(c, layer) else '' for c in cells] + differences) + ' |')
        print()
