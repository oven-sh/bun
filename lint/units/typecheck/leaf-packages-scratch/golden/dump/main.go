package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"math"
	"math/rand"
	"os"
	"strconv"

	"golden/jsnum"
	"golden/stringutil"
)

func extractStrings(file string) []string {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, nil, 0)
	if err != nil {
		panic(err)
	}
	var out []string
	ast.Inspect(f, func(n ast.Node) bool {
		if bl, ok := n.(*ast.BasicLit); ok && bl.Kind == token.STRING {
			s, err := strconv.Unquote(bl.Value)
			if err == nil {
				out = append(out, s)
			}
		}
		return true
	})
	return out
}

func main() {
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	root := "/workspace/ref/typescript-go/internal/jsnum/"
	var strs []string
	strs = append(strs, extractStrings(root+"string_test.go")...)
	strs = append(strs, extractStrings(root+"ryu_test.go")...)
	strs = append(strs, extractStrings(root+"pseudobigint_test.go")...)
	extra := []string{"0x8000000000000000", "0x7fffffffffffffff", "0xFFFFFFFFFFFFFFFFF", "0b" + string(make([]byte, 0)), "9223372036854775807", "9223372036854775808", "18446744073709551616", "1e21", "1e-7", "123456789012345678901234567890", "0o7777777777777777777777", "0b1111111111111111111111111111111111111111111111111111111111111111111", "0x1fffffffffffff8", "0x1fffffffffffffc", "0x20000000000001", "0x20000000000003", "0x3ffffffffffffe", "0x3fffffffffffff", "1e400", "-1e400", "1e-400", "4.9e-324", "2.4703282292062328e-324", "2.4703282292062327e-324", "-", "+.5", "-.5e-3", ".5e+3", "5e", "0x-1", "-0x1", "+0x1", "00", "-00", "0012", "0.0012e5", "١٢٣", "1\u0000", "Infinity ", "-Infinity", "+Infinity", "infinity", "INFINITY", "1e+", "1E5", "1.e5", "1..5", "0xg", "0b", "0o", "0X", "1e5e5", "\uFEFF1", "\u180e1", "\u2000 1 \u3000", "\u0085 1", "0x1p3", "1f", "0.1e-320"}
	strs = append(strs, extra...)
	for _, s := range strs {
		n := jsnum.FromString(s)
		fmt.Fprintf(w, "F\t%s\t%016x\n", hex.EncodeToString([]byte(s)), math.Float64bits(float64(n)))
		if !n.IsNaN() {
			fmt.Fprintf(w, "S\t%016x\t%s\n", math.Float64bits(float64(n)), n.String())
		}
	}
	r := rand.New(rand.NewSource(12345))
	emit := func(f float64) {
		fmt.Fprintf(w, "S\t%016x\t%s\n", math.Float64bits(f), jsnum.Number(f).String())
	}
	specials := []float64{0, math.Copysign(0, -1), 1, -1, 1e21, 1e21 - 65536, 1e-6, 1e-7, 9.999999999999999e-7, 1e20, 1e22, 123456789012345680000, 5e-324, math.MaxFloat64, math.SmallestNonzeroFloat64, 9007199254740991, 9007199254740992, 9007199254740993, -9007199254740992, 0.1, 0.2, 0.30000000000000004, 4.35, 1.7976931348623157e308, 2.2250738585072014e-308, 1e300, 1.5, 100, 1e15, 1e16, 1e17, 123456.789e3, 0.000001234, 0.0000001234, math.NaN(), math.Inf(1), math.Inf(-1)}
	for _, f := range specials {
		emit(f)
	}
	for i := 0; i < 300000; i++ {
		var f float64
		switch i % 4 {
		case 0:
			f = math.Float64frombits(r.Uint64())
		case 1:
			f = float64(r.Int63n(1<<60)) / float64(int64(1)<<uint(r.Intn(70)))
		case 2:
			f = (r.Float64() - 0.5) * math.Pow(10, float64(r.Intn(60)-30))
		case 3:
			f = float64(r.Int63n(1 << 62))
		}
		if math.IsNaN(f) {
			continue
		}
		emit(f)
	}
	// toInt32 / bit ops
	for i := 0; i < 20000; i++ {
		a := math.Float64frombits(r.Uint64())
		b := float64(r.Int63n(1<<40)) - float64(int64(1)<<39) + r.Float64()
		if i%3 == 0 {
			a = float64(r.Int63n(1<<35)) - float64(int64(1)<<34)
		}
		x, y := jsnum.Number(a), jsnum.Number(b)
		fmt.Fprintf(w, "B\t%016x\t%016x\t%016x\t%016x\t%016x\t%016x\t%016x\t%016x\t%016x\n", math.Float64bits(a), math.Float64bits(b),
			math.Float64bits(float64(x.BitwiseOR(y))), math.Float64bits(float64(x.BitwiseAND(y))), math.Float64bits(float64(x.BitwiseXOR(y))),
			math.Float64bits(float64(x.SignedRightShift(y))), math.Float64bits(float64(x.UnsignedRightShift(y))), math.Float64bits(float64(x.LeftShift(y))),
			math.Float64bits(float64(x.Remainder(y))))
		fmt.Fprintf(w, "N\t%016x\t%016x\n", math.Float64bits(a), math.Float64bits(float64(x.BitwiseNOT())))
	}
	// pow with integer exponent (deterministic part) and special cases
	powIn := [][2]float64{{2, 3}, {1.1, 10}, {10, 308}, {5, 210}, {10, 200}, {3, 40}, {10, -3}, {2, 1024}, {2, 1023}, {2, -1074}, {2, -1075}, {-2, 3}, {-2, 4}, {0, 0}, {math.Copysign(0, -1), 3}, {math.Copysign(0, -1), -3}, {math.Inf(1), 0}, {1, math.Inf(1)}, {-1, math.Inf(1)}, {0.5, math.Inf(1)}, {0.5, math.Inf(-1)}, {math.NaN(), 0}, {1, math.NaN()}, {7, 0.5}, {7, -0.5}, {-8, 1.0 / 3}, {1e154, 2}, {1e155, 2}, {-1e155, 3}, {9007199254740993, 2}, {3, 34}, {3, 33}, {2, 53}, {2, 54}, {1.0000001, 1e9}, {0.9999999, 1e9}, {10, 21}, {10, 22}, {10, 23}, {7, 19}, {7, 20}, {6, 21}}
	for i := 0; i < 20000; i++ {
		var b, e float64
		switch i % 3 {
		case 0:
			b = float64(r.Intn(2000) - 1000)
			e = float64(r.Intn(400))
		case 1:
			b = (r.Float64() - 0.5) * 100
			e = float64(r.Intn(200) - 100)
		case 2:
			b = r.Float64() * 1000
			e = float64(r.Intn(64)) * 7
		}
		powIn = append(powIn, [2]float64{b, e})
	}
	for _, p := range powIn {
		fmt.Fprintf(w, "P\t%016x\t%016x\t%016x\n", math.Float64bits(p[0]), math.Float64bits(p[1]), math.Float64bits(float64(jsnum.Number(p[0]).Exponentiate(jsnum.Number(p[1])))))
	}
	// pseudo bigint
	bigs := []string{"0b0n", "0b1n", "0b1010n", "0b1010_0101n", "0B1101n", "0o0n", "0o7n", "0o755n", "0o7_5_5n", "0O12n", "0x0n", "0xFn", "0xFFn", "0xF_Fn", "0X1Fn", "123456789012345678901234567890n", "0x18ee90ff6c373e0ee4e3f0ad2n", "0o143564417755415637016711617605322n", "000123n", "0n", "00n", "0x00000n", "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffn", "1_000n", "0x_Fn"}
	for _, s := range bigs {
		func() {
			defer func() {
				if e := recover(); e != nil {
					fmt.Fprintf(w, "G\t%s\tPANIC\n", hex.EncodeToString([]byte(s)))
				}
			}()
			fmt.Fprintf(w, "G\t%s\t%s\n", hex.EncodeToString([]byte(s)), jsnum.ParsePseudoBigInt(s))
		}()
	}
	// case conversion over all code points
	for cp := rune(0); cp <= 0x10FFFF; cp++ {
		if cp >= 0xD800 && cp <= 0xDFFF {
			continue
		}
		s := string(cp)
		lo, up := stringutil.ToLowerJS(s), stringutil.ToUpperJS(s)
		idb := 0
		if stringutil.IsUnicodeIdentifierStart(cp) {
			idb |= 1
		}
		if stringutil.IsUnicodeIdentifierPart(cp) {
			idb |= 2
		}
		if lo != s || up != s || idb != 0 {
			fmt.Fprintf(w, "C\t%x\t%s\t%s\t%d\n", cp, hex.EncodeToString([]byte(lo)), hex.EncodeToString([]byte(up)), idb)
		}
	}
}
