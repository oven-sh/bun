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
	for r := rune(0); r <= 0x10FFFF; r++ {
		if l := unicode.ToLower(r); l != r {
			fmt.Fprintf(w, "%x %x\n", r, l)
		}
	}
}
