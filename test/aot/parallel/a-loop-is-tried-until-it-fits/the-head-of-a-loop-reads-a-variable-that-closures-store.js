// Made by the fuzzer. The head of the last do-while reads a variable that closures store; the loop inside it lets go of what is known of it.
let calls = 0;
function tick() {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
class Box {
  constructor(n, next) {
    this.n = n;
    this.next = next;
  }
}
function opaqueInt(x, y) {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueBox(x, y) {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
function opaqueAny(x) {
  tick();
  return x;
}
function drained(steps) {
  let sum = 0;
  for (let step = steps.next(0);; step = steps.next(sum & 7)) {
    sum = Math.imul(sum, 31) + step.value | 0;
    if (step.done)
      return sum;
  }
}
function fold(value) {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : value * 1000 | 0;
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      return 7;
    default:
      return value === null ? 11 : value.n | 0;
  }
}
function f0(a, b) {
  const spare = new Box(a, null);
  let v0 = a * 1 + b * 8 + 38 | 0, v1 = a * 2 + b * 7 + 2 | 0, v2 = new Box(a, null), v3 = new Box(b + 3, null), v4 = new Box(b + 4, null), v5 = new Box(b + 5, null), v6 = null, v7 = new Box(b + 7, null), v8 = new Box(b + 8, null), v9 = new Box(b + 9, null), v10 = a * 0.5, v11 = new Box(b + 11, null), v12 = new Box(b + 12, null), v13 = new Box(b + 13, null), v14 = new Box(b + 14, null), v15 = new Box(b + 15, null);
  const closure0 = (x) => {
    v1 = v1 + x | 0;
    return v1 ^ v1;
  }, closure1 = (x) => {
    v0 = v0 + x | 0;
    return v0 ^ v1;
  };
  v11 = v4.next ?? v4;
  try {
    L0: {
      v0 = v1 & v0 | 1;
      switch (v0 & 3) {
        case 0:
          v4 = v0 > 0 ? v7 : spare;
          let c1 = 1;
          L1:
            while (c1-- > 0) {
              for (const each of [v0, v1, 8]) {
                v0 = v1 + each | 0;
                v11 = opaqueBox(v12, v1);
              }
              if (v0 < v1)
                continue L1;
              if (v0 < 45)
                break L1;
              if (v1 > v1 && v1 > 9)
                break L1;
              if (v1 < 0 || v0 < 0)
                break;
            }
          break;
        case 1:
          if (v0 > v1)
            v10 = void 0;
          else {
            v2 = v0;
            let c2 = 2;
            do {
              v11 = v3.next ?? v3;
              v7 = v1 > 0 ? v11 : spare;
              v1 = closure1(v0);
              v15 = v5.next ?? v5;
            } while (--c2 > 0 && v1 < v0);
          }
          v15 = v14.next ?? v14;
          v11 = new Box(v0, v4.next === null ? v4 : null);
          v0 = v0 > v0 ? v1 ^ v0 : v0 - v0 | 0;
        case 2:
          L3:
            for (let c3 = 0;c3 < 5; c3++) {
              if (v0 > v1) {
                v10 = v2 ?? v4;
                v3 = v0 > 0 ? v11 : spare;
                v14 = new Box(v0, null);
              } else {
                v12 = opaqueBox(v3, v1);
                v2 = v0;
                v8 = opaqueBox(v15, v1);
              }
              v14 = v7.next ?? v7;
              try {
                v10 = v0;
                v3 = new Box(v0, v14.next === null ? v14 : null);
                v6 = v1;
              } finally {
                v1 = opaqueInt(v0, v1);
              }
              try {
                v7 = v8.next ?? v8;
                v15.n = v1 + v0 | 0;
                v0 = v0 > 0 ? v0 : v0;
                v6 = null;
                if (v1 & 1)
                  throw v0;
                v15 = new Box(v0, v7.next === null ? v7 : null);
                v15.n = 1;
              } catch (thrown) {
                v0 = (thrown | 0) + 1;
                v7 = new Box(v0, null);
              } finally {
                v7 = new Box(v1, null);
              }
            }
          v14 = v13.next ?? v13;
          let c4 = 1;
          L4:
            while (c4-- > 0) {
              v9 = v5.next ?? v5;
              for (const each of [v0, v1, 7]) {
                v1 = v0 + each | 0;
                v4 = new Box(v1, null);
              }
              if (v1 & 1)
                break L4;
              if (v1 > v1 && v1 > 2)
                break;
            }
          v2 = v1 > 0 ? v1 : "t";
          break;
        default:
          v2 = "t";
      }
      L5: {
        try {
          if (v0 > v1 && v1 > 4)
            v3 = v0 > 0 ? v8 : spare;
          else {
            v15 = opaqueBox(v4, v0);
            v0 = v0 * 0.5 + v0 | 0;
            v13 = v13;
            v5 = new Box(v0, v13.next === null ? v13 : null);
          }
          L6:
            for (let c6 = 0;c6 < 2; c6++)
              v4 = v0 > 0 ? v9 : spare;
          if (typeof v6 > "u")
            throw v1;
          switch (v1 & 3) {
            case 0:
              v13 = new Box(v0, null);
              v11 = v11.next ?? v11;
              break;
            case 1:
              v9.n = opaqueInt(v0, v1);
              v9 = opaqueBox(v11, v1);
              v4 = v14;
            case 2:
              v12 = v9.next ?? v9;
              v13.n = v0 % ((v0 & 15) + 1) | 0;
              v10 = v12;
              break;
            default:
              v15 = v0 > 0 ? v4 : spare;
          }
          try {
            v0 = closure1(v0);
            v4 = v12;
            v7 = opaqueBox(v11, v0);
            v7 = opaqueBox(v9, v0);
            if (v0 < v0)
              throw v0;
            v0 = Math.imul(v0, v0);
          } catch (thrown) {
            v1 = (thrown | 0) + 1;
            v3 = new Box(v0, v9.next === null ? v9 : null);
          } finally {
            v3 = opaqueBox(v15, v1);
          }
          v8 = v12.next ?? v12;
          L7: {
            v7 = v5;
            if (v1 > v1 && v1 > 6)
              break L7;
            v5.n = v0 * 3 | 0;
          }
        } catch (thrown) {
          v0 = (thrown | 0) + 1;
          v9 = new Box(v0, null);
        } finally {
          v11 = new Box(v0, v13.next === null ? v13 : null);
        }
        switch (v1 & 3) {
          case 0:
            v3 = new Box(v0, v3.next === null ? v3 : null);
            break;
          case 1:
            switch (v1 & 3) {
              case 0:
                v4 = opaqueBox(v9, v0);
                v13 = new Box(v1, v7.next === null ? v7 : null);
                v13 = opaqueBox(v8, v0);
                break;
              case 1:
                v15 = new Box(v1, null);
              case 2:
                v13 = v0 > 0 ? v5 : spare;
                v3 = new Box(v0, v12.next === null ? v12 : null);
                v3 = v11;
                break;
              default:
                v2 = v1 > 0;
                v1 = v0 > v1 ? v0 : v1;
                v10 = "t";
                v9 = opaqueBox(v12, v1);
            }
            v5 = new Box(v1, null);
          case 2:
            v6 = v0;
            L8:
              for (let c8 = 0;c8 < 4; c8++) {
                v10 = v0;
                v1 = v1 + 88 | 0;
              }
            v5 = v3.next ?? v3;
            break;
          default:
            try {
              v10 = v1 > 0 ? v1 : "t";
              v6 = v1;
            } finally {
              switch (v0 & 3) {
                case 0:
                  v4 = v8;
                  break;
                case 1:
                  v0 = closure1(v0);
                case 2:
                  v8.n = v0 * 3 | 0;
                  break;
                default:
                  v6 = v0;
              }
            }
            v11 = opaqueBox(v12, v0);
            try {
              v9 = new Box(v0, null);
              v0 = v1 + 60 | 0;
              if (v0 < v1)
                throw v1;
              v4 = v0 > 0 ? v7 : spare;
            } catch (thrown) {
              v0 = (thrown | 0) + 1;
              v12 = new Box(v1, v8.next === null ? v8 : null);
            } finally {
              v12.n = v0 > v1 ? v0 : v1;
            }
            v7 = v4;
        }
        try {
          v3 = new Box(v0, v14.next === null ? v14 : null);
          if (v0 === v0)
            v12.n = v0 & v0 | 1;
          else
            v12 = v1 > 0 ? v15 : spare;
          v4 = v1 > 0 ? v14 : spare;
          v3.n = closure1(v0);
        } catch (thrown) {
          v0 = (thrown | 0) + 1;
          v8 = v3;
        } finally {
          v7 = v13.next ?? v13;
        }
        v2 = opaqueAny(v10);
        try {
          for (const each of [v0, v0, 0]) {
            v1 = v1 + each | 0;
            v9 = opaqueBox(v4, v1);
            v11 = v0 > 0 ? v9 : spare;
          }
          try {
            v6 = opaqueAny(v2);
            v1 = v1 % ((v1 & 15) + 1) | 0;
            v8 = v1 > 0 ? v9 : spare;
            v14 = opaqueBox(v9, v0);
          } finally {
            v4 = new Box(v0, v15.next === null ? v15 : null);
          }
          L9:
            for (let c9 = 0;c9 < 1; c9++) {
              v9 = new Box(v0, v9.next === null ? v9 : null);
              v9 = new Box(v1, v13.next === null ? v13 : null);
              v9 = new Box(v0, null);
              v3 = new Box(v1, v3.next === null ? v3 : null);
            }
          if (v1 > v1) {
            v7.n = v9.n | 0;
            v0 = opaqueInt(v1, v1);
            v11 = v13;
            v12 = v8.next ?? v8;
          } else {
            v14 = v1 > 0 ? v7 : spare;
            v2 = v6 ?? v4;
            v14.n = v0 > v1 ? v0 : v1;
          }
        } finally {
          v15 = opaqueBox(v13, v0);
        }
        let c10 = 1;
        do {
          switch (v1 & 3) {
            case 0:
              v12 = new Box(v1, null);
              v15 = new Box(v0, null);
              v6 = v4;
              v10 = v1;
              break;
            case 1:
              v12 = opaqueBox(v15, v1);
            case 2:
              v8 = new Box(v0, v7.next === null ? v7 : null);
              break;
            default:
              v10 = opaqueAny(v6);
              v8.n = v0 + v0 | 0;
          }
          let c11 = 1;
          L11:
            while (c11-- > 0) {
              v0 = v1 + v0 | 0;
              v11 = v8.next ?? v8;
              v7 = v4;
              if (v5.n > v0)
                continue;
            }
        } while (--c10 > 0 && v4.n > v0);
        v1 = v1 >>> 3 & 1023;
      }
      v6 = typeof v6 === "number" ? v6 + 1 : v1;
      if (v1 < 0 || v0 < 0)
        break L0;
      v8 = new Box(v0, v11.next === null ? v11 : null);
      L12: {
        v4 = new Box(v0, null);
        try {} finally {
          v3 = v15.next ?? v15;
        }
        if (v0 < v1)
          break L12;
      }
    }
  } finally {
    switch (v0 & 3) {
      case 0:
        v8 = v1 > 0 ? v11 : spare;
        break;
      case 1:
        v14 = v8;
      case 2:
        v2 = void 0;
        break;
      default:
        v10 = typeof v6 === "number" ? v6 + 1 : v1;
    }
  }
  return v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) | 0;
}
let hash = 0;
const turns = Number(process.argv[2] ?? 100);
for (let i = 0; i < turns; i++) hash = (Math.imul(hash, 31) + f0(i, (i * 7) & 63)) | 0;
console.log("f0 " + (hash >>> 0).toString(16));
