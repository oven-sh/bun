// The loops of test/aot/perf/everyday/loops-over-lists-and-typed-arrays.txt in Go: the same element types, slices behind package
// variables, the bounds checks the language gives. go build.
// loops <name>: AOT_PERF_TURNS turns of that loop.
package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

var left, right []float64

//go:noinline
func float64DotProduct(i int) float64 {
	sum := float64(i & 1)
	for k := 0; k < len(left); k++ {
		sum += left[k] * right[k]
	}
	return sum
}

var counts []int32

//go:noinline
func int32ArraySum(i int) float64 {
	sum := i & 1
	for k := 0; k < len(counts); k++ {
		sum += int(counts[k])
	}
	return float64(sum)
}

var levels []float32

//go:noinline
func float32ArrayScaled(i int) float64 {
	factor := 0.5
	if i&1 != 0 {
		factor = 2
	}
	for k := 0; k < len(levels); k++ {
		levels[k] = float32(float64(levels[k]) * factor)
	}
	return float64(levels[i&511])
}

var from, to []uint8

//go:noinline
func uint8ArrayCopied(i int) float64 {
	for k := 0; k < len(from); k++ {
		to[k] = from[k]
	}
	return float64(to[i&511])
}

var bytes []uint8
var bins []int32

//go:noinline
func uint8ArrayCounted(i int) float64 {
	for k := 0; k < len(bytes); k++ {
		bins[bytes[k]]++
	}
	return float64(bins[i&255] & 1023)
}

var pixels []uint8

//go:noinline
func uint8ClampedBrightened(i int) float64 {
	by := -9
	if i&1 != 0 {
		by = 9
	}
	for k := 0; k < len(pixels); k++ {
		v := int(pixels[k]) + by
		if v < 0 {
			v = 0
		} else if v > 255 {
			v = 255
		}
		pixels[k] = uint8(v)
	}
	return float64(pixels[i&511])
}

var heights []uint16

//go:noinline
func uint16ArrayGreatest(i int) float64 {
	greatest := i & 1
	for k := 0; k < len(heights); k++ {
		height := int(heights[k])
		if height > greatest {
			greatest = height
		}
	}
	return float64(greatest)
}

var signal, smooth []float64

//go:noinline
func float64MeanOfThree(i int) float64 {
	for k := 1; k < len(signal)-1; k++ {
		smooth[k] = (signal[k-1] + signal[k] + signal[k+1]) / 3
	}
	return smooth[(i&511)+1]
}

var steps, sums []float64

//go:noinline
func float64RunningSums(i int) float64 {
	sums[0] = steps[0] + float64(i&1)
	for k := 1; k < len(steps); k++ {
		sums[k] = sums[k-1] + steps[k]
	}
	return sums[511]
}

var order []int32

//go:noinline
func int32Reversed(i int) float64 {
	for low, high := 0, len(order)-1; low < high; low, high = low+1, high-1 {
		kept := order[low]
		order[low] = order[high]
		order[high] = kept
	}
	return float64(order[i&511])
}

var depths []float64

//go:noinline
func float64Downward(i int) float64 {
	sum := float64(i & 1)
	for k := len(depths) - 1; k >= 0; k-- {
		sum += depths[k]
	}
	return sum
}

const side = 16

var table, turned []float64

//go:noinline
func float64Transposed(i int) float64 {
	for r := 0; r < side; r++ {
		for c := 0; c < side; c++ {
			turned[c*side+r] = table[r*side+c]
		}
	}
	return turned[i&255]
}

var samples []float64

//go:noinline
func total(list []float64, first float64) float64 {
	sum := first
	for k := 0; k < len(list); k++ {
		sum += list[k]
	}
	return sum
}

//go:noinline
func float64InAParameter(i int) float64 { return total(samples, float64(i&1)) }

type Series struct{ samples []float64 }

//go:noinline
func (s *Series) total(first float64) float64 {
	sum := first
	for k := 0; k < len(s.samples); k++ {
		sum += s.samples[k]
	}
	return sum
}

var series *Series

//go:noinline
func float64InAField(i int) float64 { return series.total(float64(i & 1)) }

func summer(length int) func(float64) float64 {
	samples := make([]float64, length)
	for k := range samples {
		samples[k] = float64(k) / 3
	}
	return func(first float64) float64 {
		sum := first
		for k := 0; k < len(samples); k++ {
			sum += samples[k]
		}
		return sum
	}
}

var captured func(float64) float64

//go:noinline
func float64Captured(i int) float64 { return captured(float64(i & 1)) }

var rows [][]float64

//go:noinline
func rowsOfFloat64(i int) float64 {
	sum := float64(i & 1)
	for r := 0; r < len(rows); r++ {
		row := rows[r]
		for c := 0; c < len(row); c++ {
			sum += row[c]
		}
	}
	return sum
}

var integers []int

//go:noinline
func listOfIntegersSum(i int) float64 {
	sum := i & 1
	for k := 0; k < len(integers); k++ {
		sum += integers[k]
	}
	return float64(sum)
}

//go:noinline
func listOfFractionsSum(i int) float64 {
	sum := float64(i & 1)
	for k := 0; k < len(samples); k++ {
		sum += samples[k]
	}
	return sum
}

var marks []int

//go:noinline
func listOfIntegersStored(i int) float64 {
	for k := 0; k < len(marks); k++ {
		marks[k] = (marks[k] + i) & 1023
	}
	return float64(marks[i&511])
}

type Item struct {
	worth int
	name  string
}

var items []*Item

//go:noinline
func listOfObjects(i int) float64 {
	sum := i & 1
	for k := 0; k < len(items); k++ {
		sum += items[k].worth
	}
	return float64(sum)
}

//go:noinline
func totalOfIntegers(list []int, first int) int {
	sum := first
	for k := 0; k < len(list); k++ {
		sum += list[k]
	}
	return sum
}

//go:noinline
func listOfIntegersInAParameter(i int) float64 { return float64(totalOfIntegers(integers, i&1)) }

var view []byte

//go:noinline
func dataViewSum(i int) float64 {
	sum := float64(i & 1)
	for at := 0; at < len(view); at += 8 {
		sum += math.Float64frombits(binary.LittleEndian.Uint64(view[at:]))
	}
	return sum
}

var packet []byte

//go:noinline
func bufferSum(i int) float64 {
	sum := i & 1
	for k := 0; k < len(packet); k++ {
		sum += int(packet[k])
	}
	return float64(sum)
}

//go:noinline
func bufferValues(i int) float64 {
	sum := i & 1
	for _, b := range packet {
		sum += int(b)
	}
	return float64(sum)
}

//go:noinline
func bufferEntries(i int) float64 {
	sum := i & 1
	for at, b := range packet {
		sum += int(b) * (at & 1)
	}
	return float64(sum)
}

var line string

//go:noinline
func textSum(i int) float64 {
	sum := i & 1
	for k := 0; k < len(line); k++ {
		sum += int(line[k])
	}
	return float64(sum)
}

func fractions(n int, scale, plus float64) []float64 {
	a := make([]float64, n)
	for k := range a {
		a[k] = float64(k)/scale + plus
	}
	return a
}

func main() {
	left = fractions(1000, 3, 0)
	right = make([]float64, 1000)
	counts = make([]int32, 1000)
	heights = make([]uint16, 1000)
	integers = make([]int, 1000)
	for k := 0; k < 1000; k++ {
		right[k] = 1 - float64(k)/7
		counts[k] = int32(k * 3)
		heights[k] = uint16(k * 7919)
		integers[k] = k * 3
	}
	levels = make([]float32, 512)
	from, to, bytes, pixels = make([]uint8, 512), make([]uint8, 512), make([]uint8, 512), make([]uint8, 512)
	bins = make([]int32, 256)
	order = make([]int32, 512)
	marks = make([]int, 512)
	items = make([]*Item, 512)
	for k := 0; k < 512; k++ {
		levels[k] = float32(float64(k) / 5)
		from[k] = uint8(k)
		bytes[k] = uint8(k * 7)
		pixels[k] = uint8(min(k, 255))
		order[k] = int32(k)
		marks[k] = k
		items[k] = &Item{k, "item"}
	}
	signal, smooth = fractions(514, 3, 0), make([]float64, 514)
	steps, sums = fractions(512, 9, 0), make([]float64, 512)
	depths = fractions(1000, 3, 0)
	table, turned = fractions(side*side, 3, 0), make([]float64, side*side)
	samples = fractions(1000, 3, 0.25)
	series = &Series{samples}
	captured = summer(1000)
	rows = make([][]float64, 16)
	for r := range rows {
		rows[r] = fractions(64, 3, float64(r))
	}
	view = make([]byte, 4096)
	for k := 0; k < 512; k++ {
		binary.LittleEndian.PutUint64(view[k*8:], math.Float64bits(float64(k)/3))
	}
	packet = make([]byte, 1000)
	for k := range packet {
		packet[k] = 7
	}
	line = strings.Repeat("the quick brown fox jumps over the lazy dog ", 12)

	turns := map[string]func(int) float64{
		"float64-dot-product-of-a-thousand": float64DotProduct, "int32-array-sum-of-a-thousand": int32ArraySum, "float32-array-scaled-in-place": float32ArrayScaled,
		"uint8-array-copied-by-index": uint8ArrayCopied, "uint8-array-counted-into-bins": uint8ArrayCounted, "uint8-clamped-array-brightened": uint8ClampedBrightened,
		"uint16-array-greatest-of-a-thousand": uint16ArrayGreatest, "float64-array-mean-of-three-neighbors": float64MeanOfThree, "float64-array-running-sums": float64RunningSums,
		"int32-array-reversed-in-place": int32Reversed, "float64-array-walked-downward": float64Downward, "float64-matrix-transposed-flat": float64Transposed,
		"float64-array-in-a-parameter": float64InAParameter, "float64-array-in-a-field": float64InAField, "float64-array-that-a-closure-captured": float64Captured,
		"rows-of-float64-arrays": rowsOfFloat64, "list-of-integers-sum-of-a-thousand": listOfIntegersSum, "list-of-fractions-sum-of-a-thousand": listOfFractionsSum,
		"list-of-integers-stored-to-in-place": listOfIntegersStored, "list-of-objects-one-field-summed": listOfObjects, "list-of-integers-in-a-parameter": listOfIntegersInAParameter,
		"data-view-sum-of-floats": dataViewSum, "buffer-sum-of-a-thousand": bufferSum, "buffer-values-summed": bufferValues, "buffer-entries-summed": bufferEntries,
		"text-sum-of-char-codes": textSum,
	}
	turn := turns[os.Args[1]]
	if turn == nil {
		fmt.Fprintln(os.Stderr, "no such loop:", os.Args[1])
		os.Exit(1)
	}
	n, _ := strconv.Atoi(os.Getenv("AOT_PERF_TURNS"))
	var sum int32
	for i := 0; i < n; i++ {
		sum = int32(int64(float64(sum) + turn(i)))
	}
	fmt.Println(sum)
}
