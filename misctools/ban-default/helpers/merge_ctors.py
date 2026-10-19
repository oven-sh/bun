import re, sys
ROOT = '/workspace/bun/'
def match_brace(s, i):
    depth = 0; j = i
    while True:
        if s[j] == '{': depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0: return j
        j += 1

def remove_single_fn_impl(f, name, fn):
    """delete `impl.. Name.. { [attrs] vis fn <fn>() -> Self {..} }` when that impl block has only this fn"""
    s = open(ROOT + f).read()
    pat = re.compile(r'\n((?:#\[cfg[^\n]*\]\n)*impl(?:<[^{\n]*>)?\s+' + re.escape(name) + r'(?:<[^{\n]*>)?(?:\s+where[^{]*)?\s*\{\n(?:[ \t]*///[^\n]*\n)*(?:[ \t]*#\[inline[^\]]*\]\n)?[ \t]*(?:pub(?:\([a-z]+\))?\s+)?fn ' + fn + r'\(\) -> Self \{)')
    ms = list(pat.finditer(s))
    if not ms: print('NOT FOUND', f, name, fn); return 0
    n = 0
    for m in reversed(ms):
        start = m.start(1)
        i = s.index('{', s.index('impl', start))
        j = match_brace(s, i)
        block = s[start:j+1]
        if len(re.findall(r'\bfn \w+', block)) != 1:
            print('SKIP multi-fn', f, name); continue
        before, after = s[:start], s[j+1:]
        if before.endswith('\n\n') and after.startswith('\n'): after = after[1:]
        s = before + after; n += 1
    open(ROOT + f, 'w').write(s)
    print('removed', n, f, name, fn)
    return n

def fold_wrapper(f, name, fn):
    """`fn new() -> Self { Self::<fn>() }` is deleted and `fn <fn>()` of Name becomes `fn new()`"""
    s = open(ROOT + f).read()
    # the wrapper: optional doc/attr lines, then `pub fn new() -> Self {\n Self::fn()\n }`
    wpat = re.compile(r'(?:[ \t]*///[^\n]*\n)*(?:[ \t]*#\[inline[^\]]*\]\n)?[ \t]*(?:pub(?:\([a-z]+\))?\s+)?(?:const\s+)?fn new\(\) -> Self \{\s*(?:Self|' + re.escape(name) + r')::' + fn + r'\(\)\s*\}\n\n?')
    ms = list(wpat.finditer(s))
    if len(ms) != 1: print('WRAPPER count', len(ms), f, name); return
    m = ms[0]
    # is the wrapper the only fn of its impl block? then drop the block
    s2 = s[:m.start()] + s[m.end():]
    # empty impl block left behind?
    s2 = re.sub(r'\nimpl(?:<[^{\n]*>)?\s+' + re.escape(name) + r'(?:<[^{\n]*>)?(?:\s+where[^{]*)?\s*\{\s*\}\n', '\n', s2)
    # rename the real one inside an impl of Name: first `fn <fn>() -> Self` after an `impl ... Name`
    rpat = re.compile(r'(\nimpl(?:<[^{\n]*>)?\s+' + re.escape(name) + r'(?:<[^{\n]*>)?(?:\s+where[^{]*)?\s*\{\n(?:[ \t]*///[^\n]*\n)*(?:[ \t]*#\[inline[^\]]*\]\n)?[ \t]*(?:pub(?:\([a-z]+\))?\s+)?)fn ' + fn + r'\(\) -> Self \{')
    rs = list(rpat.finditer(s2))
    if len(rs) != 1: print('REAL count', len(rs), f, name); return
    s2 = s2[:rs[0].end(1)] + 'fn new() -> Self {' + s2[rs[0].end():]
    open(ROOT + f, 'w').write(s2)
    print('folded', f, name, fn)

fold_wrapper('src/sema/util/memory.rs', 'Stable', 'init')
fold_wrapper('src/collections/zig_hash_map.rs', 'HashMap', 'init')
fold_wrapper('src/collections/array_hash_map.rs', 'StringArrayHashMap', 'init')
fold_wrapper('src/collections/array_hash_map.rs', 'StringHashMap', 'init')
fold_wrapper('src/collections/array_hash_map.rs', 'StringSet', 'empty')
fold_wrapper('src/format/ir/element.rs', 'Group', 'init')
fold_wrapper('src/format/js/jsdoc/line_buffer.rs', 'LineBuffer', 'init')
fold_wrapper('src/lint/types/id_set.rs', 'IdSet', 'init')
fold_wrapper('src/lint/types/id_set.rs', 'IdMap', 'init')
remove_single_fn_impl('src/io/write.rs', 'DiscardingWriter', 'init')
remove_single_fn_impl('src/js_parser/parser.rs', 'IdentifierOpts', 'init')
remove_single_fn_impl('src/lint/rule.rs', 'NodeTags', 'init')
remove_single_fn_impl('src/threading/Condition.rs', 'Condition', 'init')
remove_single_fn_impl('src/threading/Condition.rs', 'FutexImpl', 'init')
remove_single_fn_impl('src/threading/Mutex.rs', 'Mutex', 'init')
remove_single_fn_impl('src/threading/Mutex.rs', 'DebugImpl', 'init')
remove_single_fn_impl('src/threading/Mutex.rs', 'FutexImpl', 'init')
