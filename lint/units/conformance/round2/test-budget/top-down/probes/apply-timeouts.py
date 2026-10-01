#!/usr/bin/env python3
# usage: apply-timeouts.py <conformance.test.ts>   then run prettier --write on the file
# The timeouts of the research "test-budget" (top-down), written into the test file by the names of its tests: it works on
# the file as committed with the test of corpus-glue, and on that file with the patch of release-time-budget laid over it.
import sys
p = sys.argv[1]
s = open(p).read()

read = '''// The passes over the list, the baselines and the cases of a sample: milliseconds in a release build, seconds in a debug build, which gets the time here that the default does not give it.
const readTimeout = small ? 60_000 : undefined;
'''
old = '''// A debug build needs more than the default time of a test for the processes that a test starts.
const spawnTimeout = small ? 60_000 : undefined;
'''
new = '''// The processes that a test starts: a debug build needs seconds for each, and a release build on a machine under load needs more than the default time of a test.
const spawnTimeout = small ? 60_000 : 20_000;
'''
# The amendment of default-check-classification/top-down gives a release build its 20 seconds already.
there = 'const spawnTimeout = small ? 60_000 : 20_000;\n'
assert 'const readTimeout' not in s, "the file has the timeouts already"
if old in s:
    s = s.replace(old, new + read)
else:
    assert s.count(there) == 1, "the line of spawnTimeout is neither the one of 3110ce85cf nor the amended one"
    s = s.replace(there, there + read)

plain = [
    'the corpus holds the cases, the baselines and the lists of the pinned commits',
    "the list has the instances of the reference's run: 14,915, of which 12,797 run and 2,118 are skipped",
    'the case and space tables are those of Go',
    'the vectors of the reference parser',
    '45 cases are left out by name and 8 are run for their diagnostics alone',
    'the first section of the baselines of one of 250 cases is the plain format',
    'a batch passes when the oracle is replayed, and fails its names of list E when nothing is reported',
    'a name in the list of the other class, a skipped instance and a name of no instance are failures',
]
# The test of corpus-glue, where the file has it: 1.2 s in a debug build with the exception checks.
optional = ['an instance that the reference fails is told from one that it skips, and neither runs']
lines = s.split('\n')
for name in plain + optional:
    if name in optional and not any('"' + name + '"' in l for l in lines):
        print('the file has no test of this name, which is none of the required ones: ' + name)
        continue
    at = [i for i, l in enumerate(lines) if l.startswith('  test("' + name + '"')]
    if len(at) == 1:
        j = at[0] + 1
        while lines[j] != '  });':
            j += 1
        lines[j] = '  }, readTimeout);'
        continue
    # The form with one argument to a line: the test has a third argument already, or prettier broke a long first line.
    at = [i for i, l in enumerate(lines) if l == '    "' + name + '",' and lines[i - 1].startswith('  test')]
    assert len(at) == 1, ('no test of this name, or more than one', name)
    j = at[0] + 1
    while lines[j] != '  );':
        j += 1
    if lines[j - 1] == '    },':
        lines.insert(j, '    readTimeout,')
    else:
        print('has a third argument already, left as it is: ' + name + ' -> ' + lines[j - 1].strip())
s = '\n'.join(lines)

# The three tests of groups are in the form with one argument to a line already.
groups = [
    'are their lines of the list: group %d",',
    '"read and written again, the bytes are the same: group %d",',
    '"replayed oracles pass and a check that reports nothing passes no instance with errors: group %d",',
]
for title in groups:
    assert s.count(title) == 1, title
    end = s.index('\n  );', s.index(title))
    if s[end - 6:end] == '    },':
        s = s[:end] + '\n    readTimeout,' + s[end:]
    else:
        print('has a third argument already, left as it is: ' + title)

# The check of a test that starts a process has the time of its test: it waits for the probe of its command first.
old = '''    const options = { input, oracle: oracle ?? (() => new Uint8Array()), directory: join(String(dir), "instances") };
    return endingOf(await runInstance(instance, check, options));'''
new = '''    const options = {
      input,
      oracle: oracle ?? (() => new Uint8Array()),
      directory: join(String(dir), "instances"),
      timeoutMs: spawnTimeout,
    };
    return endingOf(await runInstance(instance, check, options));'''
amended = 'timeoutMs: more.timeoutMs };'
if old in s:
    s = s.replace(old, new)
elif s.count(amended) == 1:
    s = s.replace(amended, 'timeoutMs: more.timeoutMs ?? spawnTimeout };')
else:
    print('the helper of describe("default check") has another form: give its options timeoutMs: spawnTimeout by hand')
open(p, 'w').write(s)
