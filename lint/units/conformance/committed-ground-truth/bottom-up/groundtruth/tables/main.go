// Digests of Go's case and space tables over every code point.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"runtime"
	"unicode"

	"gt/stringutil"
)

func main() {
	lower, fold, space, white := sha256.New(), sha256.New(), sha256.New(), sha256.New()
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if l := unicode.ToLower(r); l != r {
			fmt.Fprintf(lower, "%x %x\n", r, l)
		}
		key := r
		for n := unicode.SimpleFold(r); n != r; n = unicode.SimpleFold(n) {
			key = min(key, n)
		}
		if key != r {
			fmt.Fprintf(fold, "%x %x\n", r, key)
		}
		if unicode.IsSpace(r) {
			fmt.Fprintf(space, "%x\n", r)
		}
		if stringutil.IsWhiteSpaceLike(r) {
			fmt.Fprintf(white, "%x %v %v\n", r, stringutil.IsWhiteSpaceSingleLine(r), stringutil.IsLineBreak(r))
		}
	}
	sum := func(h interface{ Sum([]byte) []byte }) string { return hex.EncodeToString(h.Sum(nil)) }
	fmt.Printf("{\"go\":%q,\"unicode\":%q,\"lower\":%q,\"foldKey\":%q,\"space\":%q,\"white\":%q}\n", runtime.Version(), unicode.Version, sum(lower), sum(fold), sum(space), sum(white))
}
