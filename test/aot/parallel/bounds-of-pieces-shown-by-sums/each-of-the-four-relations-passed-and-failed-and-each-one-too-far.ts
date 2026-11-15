function made(n: number): string { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i * 7) % 11); return s; }
function below(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i < n; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function atMost(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; i <= n - 1; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function above(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; n > i; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function atLeast(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; n - 1 >= i; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAtLeast(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (i >= n) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAbove(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (i > n - 1) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAtMost(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (n <= i) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notBelow(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 1;
  for (let i = 0; ; i++) {
    if (n - 1 < i) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function belowOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; i < n; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function atMostOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; i <= n - 1; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function aboveOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; n > i; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function atLeastOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; n - 1 >= i; i++) {
    
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAtLeastOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; ; i++) {
    if (i >= n) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAboveOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; ; i++) {
    if (i > n - 1) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notAtMostOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; ; i++) {
    if (n <= i) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
function notBelowOneTooFar(text: string, width: number): string {
  const out: string[] = [];
  const n = text.length - width + 2;
  for (let i = 0; ; i++) {
    if (n - 1 < i) break;
    out.push(text.substring(i, i + width));
  }
  return out.length + ":" + out.join(",");
}
console.log(1, below(made(10), 1), atMost(made(10), 1), above(made(10), 1), atLeast(made(10), 1), notAtLeast(made(10), 1), notAbove(made(10), 1), notAtMost(made(10), 1), notBelow(made(10), 1), belowOneTooFar(made(10), 1), atMostOneTooFar(made(10), 1), aboveOneTooFar(made(10), 1), atLeastOneTooFar(made(10), 1), notAtLeastOneTooFar(made(10), 1), notAboveOneTooFar(made(10), 1), notAtMostOneTooFar(made(10), 1), notBelowOneTooFar(made(10), 1));
console.log(3, below(made(10), 3), atMost(made(10), 3), above(made(10), 3), atLeast(made(10), 3), notAtLeast(made(10), 3), notAbove(made(10), 3), notAtMost(made(10), 3), notBelow(made(10), 3), belowOneTooFar(made(10), 3), atMostOneTooFar(made(10), 3), aboveOneTooFar(made(10), 3), atLeastOneTooFar(made(10), 3), notAtLeastOneTooFar(made(10), 3), notAboveOneTooFar(made(10), 3), notAtMostOneTooFar(made(10), 3), notBelowOneTooFar(made(10), 3));
console.log(9, below(made(10), 9), atMost(made(10), 9), above(made(10), 9), atLeast(made(10), 9), notAtLeast(made(10), 9), notAbove(made(10), 9), notAtMost(made(10), 9), notBelow(made(10), 9), belowOneTooFar(made(10), 9), atMostOneTooFar(made(10), 9), aboveOneTooFar(made(10), 9), atLeastOneTooFar(made(10), 9), notAtLeastOneTooFar(made(10), 9), notAboveOneTooFar(made(10), 9), notAtMostOneTooFar(made(10), 9), notBelowOneTooFar(made(10), 9));
console.log(10, below(made(10), 10), atMost(made(10), 10), above(made(10), 10), atLeast(made(10), 10), notAtLeast(made(10), 10), notAbove(made(10), 10), notAtMost(made(10), 10), notBelow(made(10), 10), belowOneTooFar(made(10), 10), atMostOneTooFar(made(10), 10), aboveOneTooFar(made(10), 10), atLeastOneTooFar(made(10), 10), notAtLeastOneTooFar(made(10), 10), notAboveOneTooFar(made(10), 10), notAtMostOneTooFar(made(10), 10), notBelowOneTooFar(made(10), 10));
