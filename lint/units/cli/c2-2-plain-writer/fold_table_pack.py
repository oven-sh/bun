# Reads the table that fold_table_gen.go prints (one run per line) and prints it as src/lint/tspath.rs has it.
import re, sys
rows = re.findall(r'\((0x[0-9A-F]+), (0x[0-9A-F]+), (\d), (0x[0-9A-F]+)\)', sys.stdin.read())
print('static SIMPLE_FOLD: [(u32, u32, u32, u32); %d] = [' % len(rows))
for i in range(0, len(rows), 3):
    print('    ' + ' '.join('(%s, %s, %s, %s),' % r for r in rows[i:i + 3]))
print('];')
