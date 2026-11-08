export class Kit {
  static sum(a, b) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return work === 1 ? a + b : 0;
  }
}
