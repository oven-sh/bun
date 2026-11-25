class Field {
  private readonly exp = new Uint8Array(512);
  private readonly log = new Uint8Array(256);

  constructor(primitive: number) {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      this.exp[i] = x;
      this.log[x] = i;
      x <<= 1;
      if (x & 256) x ^= primitive;
    }
    for (let i = 255; i < 512; i++) this.exp[i] = this.exp[i - 255]!;
  }

  multiply(a: number, b: number): number {
    return a === 0 || b === 0 ? 0 : this.exp[this.log[a]! + this.log[b]!]!;
  }

  power(a: number, n: number): number {
    return this.exp[(((this.log[a]! * n) % 255) + 255) % 255]!;
  }
}

class Polynomial {
  constructor(
    private readonly field: Field,
    readonly terms: readonly number[],
  ) {}

  scale(x: number): Polynomial {
    return new Polynomial(
      this.field,
      this.terms.map(term => this.field.multiply(term, x)),
    );
  }

  evaluate(x: number): number {
    return this.terms.reduce((value, term) => this.field.multiply(value, x) ^ term, 0);
  }
}

class Code {
  constructor(
    private readonly field: Field,
    private readonly parity: number,
  ) {}

  syndromes(received: readonly number[]): number[] {
    const polynomial = new Polynomial(this.field, received);
    return Array.from({ length: this.parity }, (_, i) => polynomial.evaluate(this.field.power(2, i)));
  }

  roots(received: readonly number[], length: number): number[] {
    const polynomial = new Polynomial(this.field, received);
    const found: number[] = [];
    for (let i = 0; i < length; i++) if (polynomial.evaluate(this.field.power(2, 255 - i)) === 0) found.push(length - 1 - i);
    return found;
  }
}

const field = new Field(0x11d);
const code = new Code(field, JSON.parse("8"));
const messages: number[][] = JSON.parse("[[32,91,11,120,209,114,220,77,67,64],[0,0,0,1],[255,254,253],[],[1]]");
const fractions: number[][] = JSON.parse("[[32.5,91,11.25],[0.5],[300,-1,2147483648,4294967297]]");
for (const message of messages) {
  console.log(code.syndromes(message).join(), code.roots(message, 40).join(), new Polynomial(field, message).scale(7).terms.join());
}
for (const message of fractions) console.log(new Polynomial(field, message).evaluate(3), code.syndromes(message).join());
const holes: number[] = [1, 2, 3];
delete holes[1];
console.log(new Polynomial(field, holes).evaluate(5), code.syndromes(holes).join());
