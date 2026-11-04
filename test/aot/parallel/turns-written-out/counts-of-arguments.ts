function up(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) s = s * 3 + values[i]; return s; }
function down(...values: number[]): number { let s = 0; for (let i = values.length - 1; i >= 0; i--) s = s * 3 + values[i]; return s; }
function behindTwo(a: number, b: number, ...values: number[]): number { let s = a - b; for (let i = 0; i < values.length; i++) s = s * 3 + values[i]; return s; }
let total = 0;
for (let i = 0; i < 50; i++) {
  total += up() + up(i) + up(i, 1) + up(i, 1, 2) + up(i, 1, 2, 3, 4, 5, 6, 7) + up(i, 1, 2, 3, 4, 5, 6, 7, 8) + up(i, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  total -= down() + down(i) + down(i, 1) + down(i, 1, 2) + down(i, 1, 2, 3, 4, 5, 6, 7) + down(i, 1, 2, 3, 4, 5, 6, 7, 8);
  total += behindTwo(i, 2) + (behindTwo as any)(i) + (behindTwo as any)() + behindTwo(i, 2, 3) + behindTwo(i, 2, 3, 4, 5);
}
console.log(total, up(1, 2, 3), down(1, 2, 3), behindTwo(1, 2, 3, 4), String((behindTwo as any)(1)));
