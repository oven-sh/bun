package stringutil

import "unicode/utf8"

func SimpleLowerFromTable(r rune) (rune, bool) {
	m, ok := specialCasingMappings[r]
	if !ok {
		return r, true
	}
	if utf8.RuneCountInString(m.lower) != 1 {
		return r, false
	}
	l, _ := utf8.DecodeRuneInString(m.lower)
	return l, true
}

func SimpleUpperFromTable(r rune) (rune, bool) {
	m, ok := specialCasingMappings[r]
	if !ok {
		return r, true
	}
	if utf8.RuneCountInString(m.upper) != 1 {
		return r, false
	}
	u, _ := utf8.DecodeRuneInString(m.upper)
	return u, true
}

func TableSize() int { return len(specialCasingMappings) }
