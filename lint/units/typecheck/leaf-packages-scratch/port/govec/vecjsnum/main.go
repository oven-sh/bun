// Prints what upstream's pseudo bigint functions answer.
// usage: vecjsnum > pseudobigint.tsv
package main

import (
	"fmt"

	"golden/jsnum"
)

func main() {
	texts := []string{
		"0b0n", "0b1n", "0b1010n", "0b1010_0101n", "0B1101n", "0o0n", "0o7n", "0o755n", "0o7_5_5n", "0O12n", "0x0n", "0xFn", "0xFFn", "0xF_Fn", "0X1Fn",
		"123456789012345678901234567890n", "0x18ee90ff6c373e0ee4e3f0ad2n", "0o143564417755415637016711617605322n", "000123n", "0n", "00n", "0x00000n",
		"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn", "1_000n", "0x_Fn", "", "n", "0", "1", "12n", "0x", "0xn", "0b2n", "0o8n", "0xGn", "0x1__2n", "0x12_n",
		"1x5n", "-0x1n", "-12n", "-0n", "-000n", "+5n", "0b", "0B_1n", "9007199254740993n", "0x1fffffffffffffffffn", "0b1111111111111111111111111111111111111111111111111111111111111111111n",
	}
	for _, s := range texts {
		func() {
			defer func() {
				if recover() != nil {
					fmt.Printf("P\t%s\tPANIC\n", s)
				}
			}()
			fmt.Printf("P\t%s\t%s\n", s, jsnum.ParsePseudoBigInt(s))
		}()
		func() {
			defer func() {
				if recover() != nil {
					fmt.Printf("V\t%s\tPANIC\n", s)
				}
			}()
			v := jsnum.ParseValidBigInt(s)
			fmt.Printf("V\t%s\t%d %s %s\n", s, v.Sign(), v.Base10Value, v.String())
		}()
	}
}
