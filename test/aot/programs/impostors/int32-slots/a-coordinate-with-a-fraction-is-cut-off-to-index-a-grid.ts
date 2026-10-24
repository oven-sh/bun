class Particle {
    x: number = 0;
    y: number = 0;
    constructor(public id: number) {}
}
const data = JSON.parse('{"values":[0.5,1.5,2.25]}') as { values: number[] };
const grid: number[] = [0, 0, 0, 0];
const all: Particle[] = [];
for (let i = 0; i < 100_000; i++) {
    const particle = new Particle(i);
    particle.x = data.values[i % 3];
    particle.y = data.values[(i + 1) % 3];
    all.push(particle);
}
let sum = 0;
for (let round = 0; round < 5; round++) {
    for (const particle of all) {
        grid[particle.x | 0]++;
        grid[~~particle.y]++;
        grid[particle.x >>> 0]++;
        sum += particle.x + particle.y;
    }
}
console.log(sum, grid.join(" "));
