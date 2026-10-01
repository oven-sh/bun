#!/usr/bin/env python3
# usage: knobs.py <path to conformance.test.ts>
# Lays the time limits and the flag of the whole corpus over conformance.test.ts as it is at 3110ce85cf (with or without the optional test of
# corpus-glue): the import of isCI, the constants whole, spawnTimeout, checkTimeout and slowTimeout, and their uses; the limits of the listed instances (failuresOf and the batches of expectations.json) stay as they are. Every place must be there
# exactly once, or nothing is written. Run prettier over the file afterwards: the trailing arguments are left on the closing line.
import sys
path = sys.argv[1]
s = open(path, encoding="utf8").read()
n = 0
def sub(old, new):
    global s, n
    if s.count(old) != 1:
        sys.exit(f"expected one of {old!r}, found {s.count(old)}")
    s = s.replace(old, new)
    n += 1

sub('import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";',
    'import { bunEnv, bunExe, isASAN, isCI, isDebug, isWindows, tempDir } from "harness";')
sub('''// A debug build needs more than the default time of a test for the processes that a test starts.
const spawnTimeout = small ? 60_000 : undefined;
''', '''// Every case is 12,444 files to read, which a disk that does not hold them in memory answers in tens of seconds: the release builds of CI read them all, a run by hand takes the samples.
const whole = !small && isCI;
// The processes that a test starts need more than the default time of a test: in a debug build, and in a release build on a machine under load.
const spawnTimeout = small ? 120_000 : 30_000;
// The time of one check that starts a process; the first checks of a command wait for the two runs of its probe as well. It is less than the time of the test, so that a slow check ends as one.
const checkTimeout = small ? 100_000 : 20_000;
// A debug build needs seconds for a pass over the list, a group of cases or a group of baselines, which a release build makes in milliseconds.
const slowTimeout = small ? 60_000 : undefined;
''')
# reference > the list
sub('''    expect(reasons).toEqual(reference().instances.skippedBecause);
  });
''', '''    expect(reasons).toEqual(reference().instances.skippedBecause);
  }, slowTimeout);
''')
# reference > the tables of Go
sub('''      reference().go.tables,
    );
  });
''', '''      reference().go.tables,
    );
  }, slowTimeout);
''')
# directives > the vectors
sub('''    expect(inputs.length).toBe(120);
  });
''', '''    expect(inputs.length).toBe(120);
  }, slowTimeout);
''')
# enumerator > the groups of the sample
sub('''      expect(got.sort()).toEqual(want.sort());
    },
  );
''', '''      expect(got.sort()).toEqual(want.sort());
    },
    slowTimeout,
  );
''')
# enumerator > the whole corpus
sub('''  // The whole corpus is a second of work in a release build and minutes in a debug build; the time limit is for a machine under load.
  test.skipIf(small)(
    "every instance is its line of the list, and the counts are those of the reference",''', '''  // The whole corpus is a second of work in a release build and minutes in a debug build; the time limit is the one that CI gives a test.
  test.skipIf(!whole)(
    "every instance is its line of the list, and the counts are those of the reference",''')
sub('''      }
    },
    30_000,
  );
});

describe("error baselines", () => {''', '''      }
    },
    90_000,
  );
});

describe("error baselines", () => {''')
# error baselines > the groups
sub('''        pretty: group.filter(f => pretty.includes(f.name)).length,
      });
    },
  );
''', '''        pretty: group.filter(f => pretty.includes(f.name)).length,
      });
    },
    slowTimeout,
  );
''')
# run > the groups of the sample
sub('''      for (const r of laid) seen[r.instance.oracle.class]++;
    },
  );
''', '''      for (const r of laid) seen[r.instance.oracle.class]++;
    },
    slowTimeout,
  );
''')
# plain format > the first section of the baselines
sub('''    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(10);
  });
''', '''    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(10);
  }, slowTimeout);
''')
# default check > the time of one check
sub('''    const options = { input, oracle: oracle ?? (() => new Uint8Array()), directory: join(String(dir), "instances") };
    return endingOf(await runInstance(instance, check, options));''', '''    const options = {
      input,
      oracle: oracle ?? (() => new Uint8Array()),
      directory: join(String(dir), "instances"),
      timeoutMs: checkTimeout,
    };
    return endingOf(await runInstance(instance, check, options));''')
# default check > a command that is no file
sub('''    expect(verdict.reason).toStartWith("a file without an error: the command did not start: ");
  });
''', '''    expect(verdict.reason).toStartWith("a file without an error: the command did not start: ");
  }, spawnTimeout);
''')
# listed instances > the batch
sub('''    expect(silent.map(f => [f.name, f.outcome])).toEqual(E.map(name => [name, "fail"]));
  });
''', '''    expect(silent.map(f => [f.name, f.outcome])).toEqual(E.map(name => [name, "fail"]));
  }, slowTimeout);
''')
open(path, "w", encoding="utf8").write(s)
print(f"{n} places changed")
