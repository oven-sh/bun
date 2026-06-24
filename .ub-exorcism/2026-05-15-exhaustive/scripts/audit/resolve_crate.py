#!/usr/bin/env python3
"""
scripts/audit/resolve_crate.py — map a `src/PATH` to its Bun workspace crate name.

STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/resolve_crate.py
CANONICAL LOCATION: scripts/audit/resolve_crate.py

Usage:
    echo "src/runtime/webcore/encoding.rs:303" | python3 resolve_crate.py
    # prints: bun_runtime\tsrc/runtime/webcore/encoding.rs:303

    python3 resolve_crate.py --json
    # emits the full path-to-crate map as JSON
"""
import json, re, sys, pathlib

def build_path_to_crate(repo_root):
    """Walk every src/<dir>/Cargo.toml and extract the crate name."""
    result = {}
    src_dir = pathlib.Path(repo_root) / 'src'
    if not src_dir.exists():
        return result
    for cargo in src_dir.rglob('Cargo.toml'):
        try:
            content = cargo.read_text()
            m = re.search(r'(?m)^name\s*=\s*"([^"]+)"', content)
            if m:
                rel = str(cargo.parent.relative_to(repo_root))
                result[rel] = m.group(1)
        except Exception:
            pass
    return result

def resolve(file_line, path_to_crate):
    """src/X/Y/Z.rs:NN -> (crate-name, path) by longest-prefix match."""
    if not file_line:
        return ('', '')
    fp = file_line.split(':')[0].split(',')[0].strip()
    if not fp.startswith('src/'):
        return ('', file_line)
    sorted_paths = sorted(path_to_crate.keys(), key=lambda x: -len(x))
    for p in sorted_paths:
        if fp.startswith(p + '/') or fp == p:
            return (path_to_crate[p], file_line)
    return ('', file_line)

if __name__ == '__main__':
    # Find repo root by walking up to find .ub-exorcism/
    here = pathlib.Path(__file__).resolve()
    for cand in [here.parent.parent.parent.parent, *here.parents]:
        if (cand / '.ub-exorcism').exists():
            repo_root = cand
            break
    else:
        repo_root = pathlib.Path.cwd()

    ptc = build_path_to_crate(str(repo_root))

    if '--json' in sys.argv:
        print(json.dumps(ptc, indent=2))
        sys.exit(0)

    # Default + --map-file mode: read stdin, one path per line,
    # emit "<crate>\t<path>". (--map-file is kept as an alias for the
    # default behavior; both read from stdin.)
    if sys.stdin.isatty():
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    for line in sys.stdin:
        line = line.rstrip('\n')
        crate, fp = resolve(line, ptc)
        print(f'{crate}\t{fp}')
