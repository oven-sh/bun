# The lint levels of [workspace.lints] of the repository as flags of rustc; argument: the root Cargo.toml.
import sys, tomllib
lints = tomllib.load(open(sys.argv[1], 'rb'))['workspace']['lints']
items = []
for group, prefix in (('rust', ''), ('clippy', 'clippy::')):
    for name, v in lints[group].items():
        if name in ('unexpected_cfgs', 'linker_messages'):
            continue
        level, priority = (v, 0) if isinstance(v, str) else (v['level'], v.get('priority', 0))
        items.append((priority, {'deny': '-D', 'allow': '-A', 'warn': '-W', 'forbid': '-F'}[level] + ' ' + prefix + name))
print(' '.join(flag for _, flag in sorted(items, key=lambda t: t[0])))
