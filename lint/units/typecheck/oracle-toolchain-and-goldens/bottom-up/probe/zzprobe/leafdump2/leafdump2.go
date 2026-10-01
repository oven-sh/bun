package leafdump2

import (
	"bufio"
	"fmt"
	"math"
	"math/rand"
	"os"

	"github.com/microsoft/typescript-go/internal/jsnum"
)

func Main() {
	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	r := rand.New(rand.NewSource(777))
	emit := func(f float64) {
		if math.IsNaN(f) {
			return
		}
		fmt.Fprintf(w, "S\t%016x\t%s\n", math.Float64bits(f), jsnum.Number(f).String())
	}
	for i := 0; i < 3000000; i++ {
		var f float64
		switch i % 6 {
		case 0:
			f = float64(r.Int63n(1<<60)) / float64(int64(1)<<uint(r.Intn(70)))
		case 1:
			m := uint64(r.Int63n(1<<52)) | 1<<52
			e := r.Intn(40) - 16
			f = math.Ldexp(float64(m), e-52)
		case 2:
			// few significant bits
			m := uint64(r.Int63n(1 << uint(1+r.Intn(30))))
			f = math.Ldexp(float64(m), r.Intn(140)-70)
		case 3:
			f = math.Float64frombits(r.Uint64())
		case 4:
			// decimal-ish values
			f = float64(r.Int63n(1e17)) / math.Pow(10, float64(r.Intn(25)))
		case 5:
			// powers of two and neighbours
			e := r.Intn(2098) - 1074
			f = math.Ldexp(1, e)
			switch r.Intn(3) {
			case 1:
				f = math.Nextafter(f, math.Inf(1))
			case 2:
				f = math.Nextafter(f, 0)
			}
		}
		if i%2 == 1 {
			f = -f
		}
		emit(f)
	}
}
