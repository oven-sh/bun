# Computes the h1 hash of a Go module from an extracted source tree, as golang.org/x/mod/sumdb/dirhash.Hash1 does over
# the module zip, and compares it with the line of a go.sum. Proves that a tree fetched from GitHub is the module
# that the reference pins, without the Go module proxy.
# usage: python3 modhash.py <go.sum> <module path> <version> <dir>      exit 0 when the hash is the one of go.sum
import base64, hashlib, os, sys

gosum, module, version, root = sys.argv[1:5]


def files(root):
    out = []
    for d, dirs, names in os.walk(root):
        rel = os.path.relpath(d, root).replace(os.sep, "/")
        rel = "" if rel == "." else rel + "/"
        # a nested module is not part of this module
        if rel and "go.mod" in names:
            dirs[:] = []
            continue
        dirs[:] = [x for x in dirs if x not in (".git", ".hg", ".svn", ".bzr")]
        for n in names:
            p = os.path.join(d, n)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            name = rel + n
            # vendored packages are left out, vendor/modules.txt stays
            i = name.find("/vendor/") if not name.startswith("vendor/") else -1
            if name.startswith("vendor/"):
                if "/" in name[len("vendor/"):]:
                    continue
            elif i >= 0 and "/" in name[i + len("/vendor/"):]:
                continue
            out.append(name)
    return sorted(out)


h = hashlib.sha256()
for name in files(root):
    with open(os.path.join(root, name), "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    h.update(("%s  %s@%s/%s\n" % (digest, module, version, name)).encode())
got = "h1:" + base64.b64encode(h.digest()).decode()
want = None
for line in open(gosum):
    parts = line.split()
    if len(parts) == 3 and parts[0] == module and parts[1] == version:
        want = parts[2]
if want is None:
    sys.exit("%s %s: no line in %s (computed %s)" % (module, version, gosum, got))
if got != want:
    sys.exit("%s %s: hash %s, go.sum has %s" % (module, version, got, want))
print("%s %s %s ok" % (module, version, got))
