// Research probe: the reference's own compiler test suites (internal/testrunner) inside a program that is not a test binary.
// usage: suite [-test.run <regexp>] [-test.count=1] [-test.timeout <d>] ...     the flags of a Go test binary
// TSGOPROBE_ROOT   a directory that stands for the repository root: local baselines are written below it (bootstrap.sh makes it)
// K5_MANIFEST_DIR  writes one line per run instance to <dir>/manifest.jsonl (K5_OPTS=1 adds the full compiler options)
// CTP_MODE=diag    checks each instance once and compares only the error baseline; CTP_MODE=diagdecl adds declaration diagnostics
package suite

import (
	"regexp"
	"testing"

	"github.com/microsoft/typescript-go/internal/testrunner"
)

func Main() {
	done := testrunner.ProbeSetup()
	defer done()
	match := func(pat, str string) (bool, error) { return regexp.MatchString(pat, str) }
	testing.Main(match, []testing.InternalTest{
		{Name: "TestLocal", F: func(t *testing.T) { testrunner.ProbeRunCompilerTests(t, false) }},
		{Name: "TestSubmodule", F: func(t *testing.T) { testrunner.ProbeRunCompilerTests(t, true) }},
	}, nil, nil)
}
