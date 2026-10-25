struct Vec2 {
  x;
  y;
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(other) {
    return new Vec2(this.x + other.x, this.y + other.y);
  }
  scale(k) {
    return new Vec2(this.x * k, this.y * k);
  }
}

struct Body {
  position;
  velocity;
  constructor(position, velocity) {
    this.position = position;
    this.velocity = velocity;
  }
  step(dt, bounds) {
    this.position = this.position.add(this.velocity.scale(dt));
    if (this.position.x < 0 || this.position.x > bounds.x) this.velocity = new Vec2(-this.velocity.x, this.velocity.y);
    if (this.position.y < 0 || this.position.y > bounds.y) this.velocity = new Vec2(this.velocity.x, -this.velocity.y);
  }
}

struct Particle extends Body {
  hue;
  constructor(position, velocity, hue) {
    super(position, velocity);
    this.hue = hue;
  }
}

const canvas = document.getElementById("canvas");
const stats = document.getElementById("stats");
const ctx = canvas.getContext("2d");
const bounds = new Vec2(canvas.width, canvas.height);

const particles = Array.from({ length: 400 }, (_, i) => {
  const angle = Math.random() * Math.PI * 2;
  const speed = 40 + Math.random() * 120;
  return new Particle(
    new Vec2(Math.random() * bounds.x, Math.random() * bounds.y),
    new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed),
    (i * 37) % 360,
  );
});

// Shapes are sealed: adding a field or changing the prototype throws.
try {
  particles[0].extra = true;
} catch (error) {
  stats.dataset.sealed = String(error instanceof TypeError);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  ctx.fillStyle = "rgba(11, 13, 18, 0.35)";
  ctx.fillRect(0, 0, bounds.x, bounds.y);
  for (const p of particles) {
    p.step(dt, bounds);
    ctx.fillStyle = `hsl(${p.hue} 80% 60%)`;
    ctx.fillRect(p.position.x, p.position.y, 3, 3);
  }
  stats.textContent = `${particles.length} particles, sealed shapes: ${stats.dataset.sealed}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
