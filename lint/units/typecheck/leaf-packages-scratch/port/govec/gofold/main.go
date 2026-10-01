package main

import (
	"bufio"
	"fmt"
	"os"
	"unicode"
)

func main() {
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	fmt.Fprintln(w, "version", unicode.Version)
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		l, u, f := unicode.ToLower(r), unicode.ToUpper(r), unicode.SimpleFold(r)
		if l != r || u != r || f != r {
			fmt.Fprintf(w, "%X %X %X %X\n", r, l, u, f)
		}
	}
}
