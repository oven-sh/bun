import gdb, collections
hist = collections.Counter()
class BP(gdb.Breakpoint):
    def stop(self):
        try:
            hist[int(gdb.parse_and_eval('$rdx'))] += 1
        except Exception as e:
            hist['err'] += 1
        return False
BP('mi_arenas_page_alloc_fresh')
gdb.execute('run')
import os; out = open(os.environ['OUTFILE'], 'w')
for k in sorted(hist, key=lambda x: (isinstance(x, str), x)): out.write('%s %d\n' % (k, hist[k]))
out.close()
