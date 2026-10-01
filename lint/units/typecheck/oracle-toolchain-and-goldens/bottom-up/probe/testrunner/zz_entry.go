package testrunner

import (
	"testing"

	"github.com/microsoft/typescript-go/internal/bundled"
	"github.com/microsoft/typescript-go/internal/collections"
	"github.com/microsoft/typescript-go/internal/core"
	"github.com/microsoft/typescript-go/internal/repo"
	"github.com/microsoft/typescript-go/internal/testutil/baseline"
	"github.com/microsoft/typescript-go/internal/tspath"
	"gotest.tools/v3/assert"
)

// ProbeSetup is the body of TestMain of testmain_test.go: the returned function runs after the tests.
func ProbeSetup() func() {
	core.ApplyDebugStackLimit()
	return baseline.Track()
}

// ProbeRunCompilerTests is runCompilerTests of compiler_runner_test.go, copied unchanged, for a program that is not a test binary.
func ProbeRunCompilerTests(t *testing.T, isSubmodule bool) {
	t.Parallel()

	if isSubmodule {
		repo.SkipIfNoTypeScriptSubmodule(t)
	}

	if !bundled.Embedded {
		// Without embedding, we'd need to read all of the lib files out from disk into the MapFS.
		// Just skip this for now.
		t.Skip("bundled files are not embedded")
	}

	runners := []*CompilerBaselineRunner{
		NewCompilerBaselineRunner(TestTypeRegression, isSubmodule),
		NewCompilerBaselineRunner(TestTypeConformance, isSubmodule),
	}

	var seenTests collections.Set[string]
	for _, runner := range runners {
		for _, test := range runner.EnumerateTestFiles() {
			test = tspath.GetBaseFileName(test)
			assert.Assert(t, !seenTests.Has(test), "Duplicate test file: %s", test)
			seenTests.Add(test)
		}
	}

	for _, runner := range runners {
		runner.RunTests(t)
	}
}
