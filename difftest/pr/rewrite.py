#!/usr/bin/env python3
"""Rewrites the PR body on GitHub (github-body-now.md) into body-new.md with targeted replacements."""
src = open("/tmp/arc/pr/github-body-now.md").read()

def rep(old, new):
    global src
    assert src.count(old) == 1, (src.count(old), old[:70])
    src = src.replace(old, new)

# ---- visible part
rep("- Repro: three archives into one directory (`d1 -> .`, `d1/d2/up -> ../..`, `d1/d2/up/victim/file.txt`), or a member `cfg` over an existing `cfg -> ../victim/f.txt`.",
    "- Repro: three archives into one directory: `d1 -> .`, `d1/d2/up -> ../..`, `d1/d2/up/victim/file.txt`.")
rep("- Breaking: an extraction over a symlinked directory now rejects. Reject, skip, or follow inside links: a maintainer decides.",
    "- Breaking: an extraction over a symlinked directory now rejects. Reject, skip, or follow inside links: a maintainer decides. The default extractor also rejects a directory entry that it cannot create (main ignores the failure).")
rep("- A seccomp policy that kills on `openat2` now kills `extract()`. Windows is unchanged.",
    "- A seccomp policy that kills on `openat2` now kills `extract()`. Windows still follows a junction in the destination.")

# ---- notes: state of the self-review
rep("A second, wider review of this head did not finish: the machine that ran it stopped two times. Do not merge on the strength of the line above alone.",
    "The reviews on this pull request then raised 35 more points: 30 comments longer than one line, the directory entry that was skipped in silence, and 4 points about the tests. `f2dcbf60db` adopts all of them. One review thread is open: Windows.\n\n"
    "A second, wider self-review has not finished. The machine that runs it stopped several times. Do not merge on the strength of the lines above alone.")

# ---- notes: the rejection
rep("The rejection is a `SystemError`: `code: \"ELOOP\"`, `syscall: \"open\"`, `path` is the entry (for example `shared/f.txt`). Other extraction failures still reject with the bare `Error(\"ReadError\")`.",
    "The rejection is a `SystemError`: `code: \"ELOOP\"`, `syscall: \"open\"`, `path` is the entry. The message is the standard text of the errno, for example `ELOOP: too many symbolic links encountered, open 'bin/tool'`. Other extraction failures still reject with the bare `Error(\"ReadError\")`. #44509 (draft) changes that.")

# ---- notes: behavior changes
rep("- `bun create` lists a symlink in the way as a conflict.",
    "- The default extractor rejects when it cannot create a directory entry, for example a name that is too long or a destination that is not writable. Main ignores that failure when the name has a `/` in it, and still counts the entry. The `glob` extractor skips such an entry, as before.\n"
    "- `bun create` lists a symlink in the way as a conflict.")
rep("- Everything else is as on main. A generated set of 97 archive and destination shapes, each extracted two times by both extractors, as root (umask 022 and 000) and as uid 65534, gives 194 pairs. 33 differ between main and this PR, and all 33 are in the groups above. The kernel path and the fallback walk give the same result on all 194.",
    "- Everything else is as on main. A generated set of 97 archive and destination shapes, each extracted two times by both extractors, gives 194 pairs. On `1ef3216281`, 33 pairs differ from main, as root (umask 022 and 000) and as uid 65534. All 33 are in the symlink groups above. The kernel path and the fallback walk gave the same result on all 194. On `f2dcbf60db`, as root with umask 022, 34 pairs differ: the same 33, and a directory entry with a name of 300 bytes. The other runs were not done again on `f2dcbf60db`.")

# ---- notes: cost
rep("#### Cost (release builds of the merge base and of this PR, linux-x64)\n",
    "#### Cost (release builds of the merge base and of this PR, linux-x64)\n\n"
    "The numbers are from `1ef3216281`. `f2dcbf60db` changes one error branch, comments and tests, and they were not measured again.\n")

# ---- notes: not covered
rep("I cannot build or run Windows code, so it is separate work.",
    "I cannot build or run Windows code, so it is separate work. No change for it exists yet.")

# ---- notes: relation
rep("- #40600 fixes the `make_path` loop",
    "- #44509 (draft) makes `extract()` reject with the errno of the failed call, in place of the bare `ReadError`. It changes the same functions. The one that lands second needs a rebase.\n"
    "- #40600 fixes the `make_path` loop")

# ---- notes: history
rep("This version keeps main's errors for every case without a symlink.",
    "This version keeps main's errors for every case without a symlink, and adds one: a directory entry that cannot be created.\n\n"
    "The pre-merge check asked for three cases. On `f2dcbf60db`, as uid 65534:\n\n"
    "```\n"
    "1 read-only destination: REJECTED ReadError | members 2 | on disk: (nothing)\n"
    "2 `a`, then `a/b`: REJECTED ReadError | members 3 | on disk: a\n"
    "3 layer 2 over bin -> usr/bin: REJECTED ELOOP: too many symbolic links encountered, open 'bin/tool' | members 2 | on disk: bin usr usr/bin\n"
    "```\n\n"
    "On main, case 3 resolves with 2 and writes `usr/bin/tool`.")


# ---- visible part, second pass: stay at or below 250 words
rep("pass the whole path of an entry to one `openat`, `mkdirat` or `symlinkat` call.",
    "pass an entry's whole path to one `openat`, `mkdirat` or `symlinkat` call.")
rep("- Breaking: an extraction over a symlinked directory now rejects. Reject, skip, or follow inside links: a maintainer decides. The default extractor also rejects a directory entry that it cannot create (main ignores the failure).",
    "- Breaking: an extraction over a symlinked directory rejects. Reject, skip, or follow inside links: a maintainer decides. The default extractor also rejects a directory entry that it cannot create (main ignores that).")
rep("- A seccomp policy that kills on `openat2` now kills `extract()`. Windows still follows a junction in the destination.",
    "- A seccomp policy that kills on `openat2` kills `extract()`. Windows still follows junctions.")
rep("- Without them (old Linux, seccomp, Android, FreeBSD) the parent is opened one component at a time with `O_NOFOLLOW`.",
    "- Without them (old Linux, seccomp, Android, FreeBSD) a walk opens the parent one component at a time with `O_NOFOLLOW`.")
rep("- Considered that walk alone (this PR's first version):",
    "- Considered that walk alone (the first version):")


rep("The two kernel flags cover every component.", "The kernel flags cover every component.")
rep("- A file entry replaces a symlink under its own name. Before, it wrote to the target of the link.",
    "- A file entry replaces a symlink under its own name. Before, it wrote to the target of the link. This is the short form of the report: a member `cfg` over an existing `cfg -> ../victim/f.txt`.")


rep("`f2dcbf60db` adopts all of them. One review thread is open: Windows.",
    "`f2dcbf60db` answers all of them. One review thread is open: Windows.")
rep("34 pairs differ: the same 33, and a directory entry with a name of 300 bytes.",
    "34 pairs differ: 33 in the same groups, and one directory entry with a name of 300 bytes.")

open("/tmp/arc/pr/body-new.md", "w").write(src)
