// Imported from units/typecheck/leaf-packages-scratch/golden/chk/main.go by import-legacy.sh. Do not edit here.
package leafchk

import (
	"fmt"
	"github.com/microsoft/typescript-go/internal/stringutil"
	"unicode"
)

func Main() {
	fmt.Println("go unicode version", unicode.Version, "table size", stringutil.TableSize())
	lowDiff, upDiff, multiLow, multiUp := 0, 0, 0, 0
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		l, single := stringutil.SimpleLowerFromTable(r)
		if !single {
			multiLow++
			fmt.Printf("multi-rune lower U+%04X go ToLower=U+%04X\n", r, unicode.ToLower(r))
		} else if l != unicode.ToLower(r) {
			lowDiff++
			if lowDiff < 10 {
				fmt.Printf("lower diff U+%04X table U+%04X go U+%04X\n", r, l, unicode.ToLower(r))
			}
		}
		u, single := stringutil.SimpleUpperFromTable(r)
		if !single {
			multiUp++
		} else if u != unicode.ToUpper(r) {
			upDiff++
			if upDiff < 10 {
				fmt.Printf("upper diff U+%04X table U+%04X go U+%04X\n", r, u, unicode.ToUpper(r))
			}
		}
	}
	fmt.Println("lowDiff", lowDiff, "upDiff", upDiff, "multiLow", multiLow, "multiUp", multiUp)
	// Zs members
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if unicode.Is(unicode.Zs, r) {
			fmt.Printf("Zs U+%04X ", r)
		}
	}
	fmt.Println()
	// orbits with more than two members
	n := 0
	for r := rune(0); r <= unicode.MaxRune; r++ {
		f := unicode.SimpleFold(r)
		if f != r {
			g := unicode.SimpleFold(f)
			if g != r {
				n++
				if n <= 200 {
					fmt.Printf("U+%04X->U+%04X ", r, f)
				}
			}
		}
	}
	fmt.Println("\nrunes in orbits of size>2:", n)
	// runes whose SimpleFold is not explained by ToLower/ToUpper
	odd := 0
	for r := rune(0); r <= unicode.MaxRune; r++ {
		f := unicode.SimpleFold(r)
		g := unicode.SimpleFold(f)
		if f != r && g == r {
			l, u := unicode.ToLower(r), unicode.ToUpper(r)
			if f != l && f != u {
				odd++
				if odd < 20 {
					fmt.Printf("pair not from case mapping: U+%04X<->U+%04X\n", r, f)
				}
			}
		}
	}
	fmt.Println("odd pairs", odd)
}
