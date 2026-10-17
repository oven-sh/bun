// The n-body benchmark, with classes.
class Body {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; mass: number
  constructor(x: number, y: number, z: number, vx: number, vy: number, vz: number, mass: number) {
    this.x = x; this.y = y; this.z = z; this.vx = vx; this.vy = vy; this.vz = vz; this.mass = mass
  }
}
const PI = 3.141592653589793, SOLAR_MASS = 4 * PI * PI, DAYS = 365.24
function bodies(): Body[] {
  return [
    new Body(0, 0, 0, 0, 0, 0, SOLAR_MASS),
    new Body(4.84143144246472082945e+00, -1.16032004402742839362e+00, -1.03622044471123109494e-01, 1.66007664274403694959e-03 * DAYS, 7.69901118419740425080e-03 * DAYS, -6.90460016972063023554e-05 * DAYS, 9.54791938424326609124e-04 * SOLAR_MASS),
    new Body(8.34336671824457987790e+00, 4.12479856412430479268e+00, -4.03523417114321381293e-01, -2.76742510726862411004e-03 * DAYS, 4.99852801234917238954e-03 * DAYS, 2.30417297573763929463e-05 * DAYS, 2.85885980666130812119e-04 * SOLAR_MASS),
    new Body(1.28943695621391310164e+01, -1.51111514016986312525e+01, -2.23307578892655734398e-01, 2.96460137564761618652e-03 * DAYS, 2.37847173959480950187e-03 * DAYS, -2.96589568540237556131e-05 * DAYS, 4.36624404335156298062e-05 * SOLAR_MASS),
    new Body(1.53796971148509165498e+01, -2.59193146099879641146e+01, 1.79258772950371181757e-01, 2.68067772490389322511e-03 * DAYS, 1.62824170038242295431e-03 * DAYS, -9.51592254519715870971e-05 * DAYS, 5.15138902046611451304e-05 * SOLAR_MASS),
  ]
}
function offsetMomentum(b: Body[]): void {
  let px = 0, py = 0, pz = 0
  for (let i = 0; i < b.length; i++) { const o = b[i]!; px += o.vx * o.mass; py += o.vy * o.mass; pz += o.vz * o.mass }
  b[0]!.vx = -px / SOLAR_MASS; b[0]!.vy = -py / SOLAR_MASS; b[0]!.vz = -pz / SOLAR_MASS
}
function advance(b: Body[], dt: number): void {
  const n = b.length
  for (let i = 0; i < n; i++) {
    const bi = b[i]!
    for (let j = i + 1; j < n; j++) {
      const bj = b[j]!
      const dx = bi.x - bj.x, dy = bi.y - bj.y, dz = bi.z - bj.z
      const d2 = dx * dx + dy * dy + dz * dz
      const mag = dt / (d2 * Math.sqrt(d2))
      bi.vx -= dx * bj.mass * mag; bi.vy -= dy * bj.mass * mag; bi.vz -= dz * bj.mass * mag
      bj.vx += dx * bi.mass * mag; bj.vy += dy * bi.mass * mag; bj.vz += dz * bi.mass * mag
    }
  }
  for (let i = 0; i < n; i++) { const o = b[i]!; o.x += dt * o.vx; o.y += dt * o.vy; o.z += dt * o.vz }
}
function energy(b: Body[]): number {
  let e = 0
  for (let i = 0; i < b.length; i++) {
    const bi = b[i]!
    e += 0.5 * bi.mass * (bi.vx * bi.vx + bi.vy * bi.vy + bi.vz * bi.vz)
    for (let j = i + 1; j < b.length; j++) { const bj = b[j]!; const dx = bi.x - bj.x, dy = bi.y - bj.y, dz = bi.z - bj.z; e -= (bi.mass * bj.mass) / Math.sqrt(dx * dx + dy * dy + dz * dz) }
  }
  return e
}
const t0 = performance.now()
const sys = bodies(); offsetMomentum(sys)
for (let i = 0; i < 5000000; i++) advance(sys, 0.01)
console.log("nbody", energy(sys).toFixed(9), (performance.now() - t0).toFixed(0) + "ms")
