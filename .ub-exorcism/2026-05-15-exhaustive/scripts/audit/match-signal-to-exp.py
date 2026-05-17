#!/usr/bin/env python3
"""
scripts/audit/match-signal-to-exp.py — match a UB stderr signal to a known EXP-NNN.

STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/match-signal-to-exp.py
CANONICAL LOCATION: scripts/audit/match-signal-to-exp.py

Usage:
    cat some_miri_output.log | python3 match-signal-to-exp.py
    # prints: matches: EXP-001 (uninitialized memory), EXP-004 (allocator-layout)
    # or:     matches: (no known signature)

    python3 match-signal-to-exp.py --json
    # prints structured output

Signature table is derived from each EXP's "Expected signal" registry field.
"""
import json, re, sys

# Signal classifier table — derived from UB-bucket taxonomy.
# Each entry: (regex, bucket-tag, EXP-NNN(s) likely matching, plain-English)
SIGNATURES = [
    (r'incorrect layout on deallocation', 'allocator-pairing',
     ['EXP-004', 'EXP-091', 'EXP-092'], 'allocator-pairing (Vec/Box layout mismatch)'),
    (r'reading memory.+is uninitialized|uninitialized.+operation requires initialized',
     'uninit', ['EXP-001', 'EXP-005', 'EXP-034', 'EXP-089'], 'read of uninitialized memory'),
    (r'constructing invalid value of type|encountered.+expected a valid enum tag',
     'validity', ['EXP-002', 'EXP-003', 'EXP-006', 'EXP-035', 'EXP-036', 'EXP-051', 'EXP-097'],
     'invalid enum / validity invariant'),
    (r'trying to retag from.+Unique permission|tag does not exist in the borrow stack',
     'aliasing', ['EXP-026', 'EXP-073', 'EXP-074', 'EXP-076', 'EXP-094', 'EXP-111'],
     'aliasing / borrow-stack retag'),
    (r'protected tag.+was disabled|protected tag.+disabled here because',
     'tree-borrows', ['EXP-026', 'EXP-073', 'EXP-074', 'EXP-076', 'EXP-111'],
     'Tree-Borrows protected tag disabled by foreign access'),
    (r'pointer not dereferenceable|dangling pointer.+no provenance',
     'dangling-pointer', ['EXP-056', 'EXP-081', 'EXP-109'],
     'dangling pointer dereference (use-after-free shape)'),
    (r'unaligned|alignment\s+\d+|sufficiently aligned',
     'alignment', ['EXP-095'], 'unaligned reference / load'),
    (r'Data race detected', 'data-race',
     ['EXP-017', 'EXP-030', 'EXP-031', 'EXP-046', 'EXP-047', 'EXP-111'],
     'cross-thread data race (TSan / Miri concurrent)'),
    (r'deallocation through.+is forbidden|free.+through shared',
     'free-shared', ['EXP-056'], 'deallocation through shared-provenance pointer'),
    (r'reborrow.+is forbidden|reborrow.+root.+forbidden',
     'tree-borrows-reborrow', ['EXP-026'], 'Tree-Borrows reborrow forbidden'),
    (r'entering unreachable code', 'unreachable_unchecked',
     ['EXP-086'], 'reached unreachable_unchecked'),
]

def classify(text):
    matches = []
    for regex, bucket, exps, plain in SIGNATURES:
        if re.search(regex, text, re.IGNORECASE):
            matches.append({"regex": regex, "bucket": bucket,
                           "candidate_exps": exps, "plain_english": plain})
    return matches

def main():
    json_out = '--json' in sys.argv
    text = sys.stdin.read()
    matches = classify(text)

    if json_out:
        print(json.dumps({"matches": matches, "match_count": len(matches)}, indent=2))
        return

    if not matches:
        print("matches: (no known UB-signature pattern found in input)")
        return

    print(f"matches ({len(matches)} signature(s)):")
    for m in matches:
        cands = ', '.join(m["candidate_exps"])
        print(f"  - {m['bucket']}: {m['plain_english']}")
        print(f"      candidate EXPs: {cands}")
        print(f"      regex: /{m['regex']}/")

if __name__ == '__main__':
    main()
