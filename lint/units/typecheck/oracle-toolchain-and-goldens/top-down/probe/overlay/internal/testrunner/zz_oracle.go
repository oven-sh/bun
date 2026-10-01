// Research probe: runCompilerTests of compiler_runner_test.go for a caller outside a test binary.
package testrunner

import "testing"

// OracleRunCompilerTests runs the regression and the conformance suite, as TestSubmodule (true) or TestLocal (false) do.
func OracleRunCompilerTests(t *testing.T, isSubmodule bool) {
	t.Parallel()
	runners := []*CompilerBaselineRunner{
		NewCompilerBaselineRunner(TestTypeRegression, isSubmodule),
		NewCompilerBaselineRunner(TestTypeConformance, isSubmodule),
	}
	for _, runner := range runners {
		runner.RunTests(t)
	}
}
