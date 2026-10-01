package checker

import (
	"github.com/microsoft/typescript-go/internal/ast"
)

// Research probe only: height of the type resolution stack.
func (c *Checker) ProbeResolutionDepth() int { return len(c.typeResolutions) }

// Research probe only: the entries of the type resolution stack.
func (c *Checker) ProbeResolutionStack() []string {
	var out []string
	for _, r := range c.typeResolutions {
		name := "?"
		switch t := r.target.(type) {
		case *ast.Symbol:
			name = "symbol:" + t.Name
		case *Type:
			name = "type"
		case *Signature:
			name = "signature"
		case *ast.Node:
			name = "node"
		}
		out = append(out, name)
	}
	return out
}
