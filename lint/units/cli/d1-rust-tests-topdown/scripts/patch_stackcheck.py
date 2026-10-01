import sys
p = '/tmp/cli-d1/tree/src/bun_core/util.rs'
s = open(p).read()
open('/tmp/cli-d1/variants/0/util.rs', 'w').write(s)
i = s.index('    fn frame_address() -> usize {')
j = s.index('\n    }\n', i)
body = s[i:j]
new = body.replace('#[cfg(target_arch = "x86_64")]', '#[cfg(all(target_arch = "x86_64", not(miri)))]', 1)
new = new.replace('#[cfg(target_arch = "aarch64")]', '#[cfg(all(target_arch = "aarch64", not(miri)))]', 1)
new = new.replace('#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]', '#[cfg(any(miri, not(any(target_arch = "x86_64", target_arch = "aarch64"))))]', 1)
assert new != body and new.count('miri') == 3, 'patch did not apply'
open(p, 'w').write(s[:i] + new + s[j:])
print('patched')
