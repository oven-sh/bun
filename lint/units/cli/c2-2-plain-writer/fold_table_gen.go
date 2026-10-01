//go:build ignore

package main

import (
	"fmt"
	"unicode"
)

func key(r rune) rune {
	k := r
	for x := unicode.SimpleFold(r); x != r; x = unicode.SimpleFold(x) {
		if x < k {
			k = x
		}
	}
	return k
}

type ent struct {
	lo, hi rune
	stride rune
	delta  rune
}

func main() {
	var ents []ent
	for r := rune(0x80); r <= unicode.MaxRune; r++ {
		k := key(r)
		if k == r {
			continue
		}
		d := k - r
		if len(ents) > 0 {
			e := &ents[len(ents)-1]
			if e.delta == d {
				if e.lo == e.hi && (r-e.hi == 1 || r-e.hi == 2) {
					e.stride = r - e.hi
					e.hi = r
					continue
				}
				if e.lo != e.hi && r-e.hi == e.stride {
					e.hi = r
					continue
				}
			}
		}
		ents = append(ents, ent{r, r, 1, d})
	}
	fmt.Printf("static SIMPLE_FOLD: [(u32, u32, u32, u32); %d] = [\n", len(ents))
	for _, e := range ents {
		fmt.Printf("    (0x%04X, 0x%04X, %d, 0x%04X),\n", e.lo, e.hi, e.stride, e.lo+e.delta)
	}
	fmt.Printf("];\n")
}
