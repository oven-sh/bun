package leafdump3

import (
	"fmt"
	"math"
	"math/rand"

	"github.com/microsoft/typescript-go/internal/jsnum"
)

func Main() {
	r := rand.New(rand.NewSource(99))
	for i := 0; i < 20000; i++ {
		b := r.Float64() * 100
		e := (r.Float64() - 0.5) * 20
		if i%4 == 0 {
			e = float64(r.Intn(40)-20) + 0.5
		}
		if i%4 == 1 {
			e = float64(r.Intn(9)+1) / 10
		}
		fmt.Printf("P\t%016x\t%016x\t%016x\n", math.Float64bits(b), math.Float64bits(e), math.Float64bits(float64(jsnum.Number(b).Exponentiate(jsnum.Number(e)))))
	}
}
