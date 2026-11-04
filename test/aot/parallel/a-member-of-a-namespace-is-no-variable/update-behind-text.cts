namespace Box {
  export var count = 1;
  export function bump(code: string): number { eval(code); count++; count += 10; return count; }
}
console.log(Box.bump("var count = 100"), Box.count);
