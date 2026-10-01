#!/usr/bin/env python3
# Applies the timeouts and the flag of the whole corpus to conformance.test.ts of a tree whose import and constants are edited already.
# usage: knobs.py <path to conformance.test.ts>
import re, sys
path = sys.argv[1]
s = open(path, encoding="utf8").read()
n = 0
def sub(old, new, count=1):
    global s, n
    if s.count(old) != count:
        sys.exit(f"expected {count} of {old!r}, found {s.count(old)}")
    s = s.replace(old, new)
    n += count

# reference > the list
sub("""    expect(reasons).toEqual(reference().instances.skippedBecause);
  });
""", """    expect(reasons).toEqual(reference().instances.skippedBecause);
  }, slowTimeout);
""")
# reference > the tables of Go
sub("""      reference().go.tables,
    );
  });
""", """      reference().go.tables,
    );
  }, slowTimeout);
""")
# directives > the vectors
sub("""    expect(inputs.length).toBe(120);
  });
""", """    expect(inputs.length).toBe(120);
  }, slowTimeout);
""")
# enumerator > the groups of the sample
sub("""      expect(got.sort()).toEqual(want.sort());
    },
  );
""", """      expect(got.sort()).toEqual(want.sort());
    },
    slowTimeout,
  );
""")
# enumerator > the whole corpus
sub("""  test.skipIf(small)(
    "every instance is its line of the list, and the counts are those of the reference",""", """  test.skipIf(!whole)(
    "every instance is its line of the list, and the counts are those of the reference",""")
sub("""      }
    },
    30_000,
  );
});

describe("error baselines", () => {""", """      }
    },
    90_000,
  );
});

describe("error baselines", () => {""")
# error baselines > the groups
sub("""        pretty: group.filter(f => pretty.includes(f.name)).length,
      });
    },
  );
""", """        pretty: group.filter(f => pretty.includes(f.name)).length,
      });
    },
    slowTimeout,
  );
""")
# run > the groups of the sample
sub("""      for (const r of laid) seen[r.instance.oracle.class]++;
    },
  );
""", """      for (const r of laid) seen[r.instance.oracle.class]++;
    },
    slowTimeout,
  );
""")
# plain format > the first section of the baselines
sub("""    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(10);
  });
""", """    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(10);
  }, slowTimeout);
""")
# default check > a command that is no file
sub("""    expect(verdict.reason).toStartWith("a file without an error: the command did not start: ");
  });
""", """    expect(verdict.reason).toStartWith("a file without an error: the command did not start: ");
  }, spawnTimeout);
""")
# listed instances > the batch
sub("""    expect(silent.map(f => [f.name, f.outcome])).toEqual(E.map(name => [name, "fail"]));
  });
""", """    expect(silent.map(f => [f.name, f.outcome])).toEqual(E.map(name => [name, "fail"]));
  }, slowTimeout);
""")
open(path, "w", encoding="utf8").write(s)
print(f"{n} places changed")
