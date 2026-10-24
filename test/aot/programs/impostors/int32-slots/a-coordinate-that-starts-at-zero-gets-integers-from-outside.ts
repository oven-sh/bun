class Particle {
    x: number = 0;
    y: number = 0;
    constructor(public id: number) {}
}
const data = JSON.parse('{"values":[5,15,225]}') as { values: number[] };
const all: Particle[] = [];
for (let i = 0; i < 100_000; i++) {
    const particle = new Particle(i);
    particle.x = data.values[i % 3];
    particle.y = data.values[(i + 1) % 3];
    all.push(particle);
}
let sum = 0;
for (let round = 0; round < 5; round++) {
    for (const particle of all)
        sum += particle.x + particle.y;
}
console.log(sum);
