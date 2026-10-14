// The fannkuch-redux benchmark: integer arithmetic on small typed arrays.
function fannkuch(n: number): number {
  const p = new Int32Array(n), q = new Int32Array(n), s = new Int32Array(n)
  let sign = 1, maxflips = 0, sum = 0
  for (let i = 0; i < n; i++) { p[i] = i; q[i] = i; s[i] = i }
  for (;;) {
    let q0 = p[0]!
    if (q0 !== 0) {
      for (let i = 1; i < n; i++) q[i] = p[i]!
      let flips = 1
      for (;;) {
        const qq = q[q0]!
        if (qq === 0) { sum += sign * flips; if (flips > maxflips) maxflips = flips; break }
        q[q0] = q0
        if (q0 >= 3) { let i = 1, j = q0 - 1; do { const t = q[i]!; q[i] = q[j]!; q[j] = t; i++; j-- } while (i < j) }
        q0 = qq; flips++
      }
    }
    if (sign === 1) { const t = p[1]!; p[1] = p[0]!; p[0] = t; sign = -1 }
    else {
      const t = p[1]!; p[1] = p[2]!; p[2] = t; sign = 1
      for (let i = 2; i < n; i++) {
        const sx = s[i]!
        if (sx !== 0) { s[i] = sx - 1; break }
        if (i === n - 1) return sum * 1000 + maxflips
        s[i] = i
        const t2 = p[0]!; for (let j = 0; j <= i; j++) p[j] = p[j + 1]!; p[i + 1] = t2
      }
    }
  }
}
const t0 = performance.now()
console.log("fannkuch", fannkuch(10), (performance.now() - t0).toFixed(0) + "ms")
