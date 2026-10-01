package ast

// ProbeSymbolId returns the lazily assigned id of a symbol, or 0, without assigning one.
func ProbeSymbolId(s *Symbol) uint64 { return s.id.Load() }
