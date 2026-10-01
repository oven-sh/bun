// Research probe: checker-expressions-calls-flow/bottom-up/groundtruth/src/zz_probe.go.txt unchanged.
package checker

import (
	"fmt"
	"strings"
)

// ProbeState prints the checker state that the expression, call and flow layers push and pop.
func ProbeState(c *Checker) string {
	var sb strings.Builder
	free := 0
	for f := c.freeFlowState; f != nil; f = f.next {
		free++
	}
	fmt.Fprintf(&sb, "STATE flowInvocationCount=%d flowAnalysisDisabled=%v\n", c.flowInvocationCount, c.flowAnalysisDisabled)
	fmt.Fprintf(&sb, "STATE flowLoopCache=%d flowLoopStack=%d sharedFlows=%d antecedentTypes=%d flowTypeCache=%d freeFlowStates=%d\n", len(c.flowLoopCache), len(c.flowLoopStack), len(c.sharedFlows), len(c.antecedentTypes), len(c.flowTypeCache), free)
	fmt.Fprintf(&sb, "STATE flowNodeReachable=%d flowNodePostSuper=%d lastFlowNodeSet=%v lastFlowNodeReachable=%v\n", len(c.flowNodeReachable), len(c.flowNodePostSuper), c.lastFlowNode != nil, c.lastFlowNodeReachable)
	fmt.Fprintf(&sb, "STATE contextualInfos=%d inferenceContextInfos=%d awaitedTypeStack=%d reverseMappedSourceStack=%d\n", len(c.contextualInfos), len(c.inferenceContextInfos), len(c.awaitedTypeStack), len(c.reverseMappedSourceStack))
	fmt.Fprintf(&sb, "STATE typeResolutions=%d contextFreeTypes=%d currentNodeNil=%v inlineLevel=%d instantiationDepth=%d isInferencePartiallyBlocked=%v withinUnreachableCode=%v\n", len(c.typeResolutions), len(c.contextFreeTypes), c.currentNode == nil, c.inlineLevel, c.instantiationDepth, c.isInferencePartiallyBlocked, c.withinUnreachableCode)
	fmt.Fprintf(&sb, "STATE TypeCount=%d SymbolCount=%d SignatureCount=%d\n", c.TypeCount, c.SymbolCount, c.SignatureCount)
	return sb.String()
}
