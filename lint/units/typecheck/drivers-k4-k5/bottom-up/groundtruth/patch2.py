# Research probe: adds coverage snapshots at the phase borders to a COPY of typescript-go. Never run on the reference.
# usage: python3 patch2.py <copy of typescript-go>
import sys, os
root = sys.argv[1]
os.makedirs(root + '/internal/k4snap', exist_ok=True)
open(root + '/internal/k4snap/k4snap.go', 'w').write('''package k4snap

import (
	"os"
	"path/filepath"
	"runtime/coverage"
	"sync"
)

var (
	mu   sync.Mutex
	seen = map[string]bool{}
)

// Snap writes the counters since the last snapshot into $K4SNAP_DIR/<label> and clears them. Each label is written once.
func Snap(label string) {
	base := os.Getenv("K4SNAP_DIR")
	if base == "" {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if seen[label] {
		return
	}
	seen[label] = true
	dir := filepath.Join(base, label)
	_ = os.MkdirAll(dir, 0o755)
	_ = coverage.WriteMetaDir(dir)
	_ = coverage.WriteCountersDir(dir)
	_ = coverage.ClearCounters()
}
''')
def edit(rel, pairs, imp):
    p = root + '/' + rel
    s = open(p).read()
    for a, b in pairs:
        assert s.count(a) == 1, (rel, a[:60], s.count(a))
        s = s.replace(a, b)
    s = s.replace('import (\n', 'import (\n\t"github.com/microsoft/typescript-go/internal/k4snap"\n', 1)
    open(p, 'w').write(s)
edit('internal/compiler/program.go', [
    ("\tp.processedFiles = processAllProgramFiles(p.opts, p.SingleThreaded())\n\tp.initCheckerPool()\n\tp.verifyCompilerOptions()\n\tp.collectContentMapperOptionDiagnostics()\n\treturn p\n",
     "\tk4snap.Snap(\"0-startup\")\n\tp.processedFiles = processAllProgramFiles(p.opts, p.SingleThreaded())\n\tk4snap.Snap(\"1-parse\")\n\tp.initCheckerPool()\n\tp.verifyCompilerOptions()\n\tp.collectContentMapperOptionDiagnostics()\n\tk4snap.Snap(\"2-program\")\n\treturn p\n"),
    ("func (p *Program) BindSourceFiles() {\n\twg := core.NewWorkGroup(p.SingleThreaded())\n",
     "func (p *Program) BindSourceFiles() {\n\tk4snap.Snap(\"3a-prebind\")\n\tdefer k4snap.Snap(\"3b-bind\")\n\twg := core.NewWorkGroup(p.SingleThreaded())\n"),
], True)
edit('internal/checker/checker.go', [
    ("func NewChecker(program Program, tracer *Tracer) (*Checker, *sync.Mutex) {\n\tprogram.BindSourceFiles()\n",
     "func NewChecker(program Program, tracer *Tracer) (*Checker, *sync.Mutex) {\n\tprogram.BindSourceFiles()\n\tk4snap.Snap(\"4a-preinit\")\n\tdefer k4snap.Snap(\"4b-init\")\n"),
], True)
edit('internal/execute/tsc/emit.go', [
    ("\temitResult := &compiler.EmitResult{EmitSkipped: true, Diagnostics: []*ast.Diagnostic{}}\n",
     "\tk4snap.Snap(\"5-check\")\n\temitResult := &compiler.EmitResult{EmitSkipped: true, Diagnostics: []*ast.Diagnostic{}}\n"),
], True)
print('patched', root)
