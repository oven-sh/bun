// Made by the fuzzer and reduced by its reducer. The head of the last do-while reads a variable that a closure stores; the loop inside it lets go of what is known of it.
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
function drained(steps) {
}
function fold(value) {
  switch (typeof value) {
    case "number":
  }
}
function f0(a, b) {
  let v0 = a * 1 + b * 8 + 38 | 0, v1 = a * 2 + b * 7 + 2 | 0, v2 = new Box(a, null), v3 = new Box(b + 3, null), v4 = new Box(b + 4, null), v5 = new Box(b + 5, null), v6 = null, v7 = new Box(b + 7, null), v8 = new Box(b + 8, null), v9 = new Box(b + 9, null), v10 = a * 0.5, v11 = new Box(b + 11, null), v12 = new Box(b + 12, null), v13 = new Box(b + 13, null), v14 = new Box(b + 14, null), v15 = new Box(b + 15, null);
  const closure0 = (x) => {
    v1 = v1 + x | 0;
  }, closure1 = (x) => {
  };
  try {
    L0: {
      v0 = v1 & v0 | 1;
      switch (v0 & 3) {
        case 0:
            while (c1-- > 0) {
              if (v0 > v1) {
              }
              try {
                  throw v0;
              } catch (thrown) {
              }
            }
            while (c4-- > 0) {
              for (const each of [v0, v1, 7]) {
              }
            }
      }
      L5: {
        try {
          if (v0 > v1 && v1 > 4)
          switch (v1 & 3) {
          }
          try {
            v0 = closure1(v0);
          } catch (thrown) {
          }
          L7: {
          }
        } catch (thrown) {
        }
        switch (v1 & 3) {
          case 0:
            switch (v1 & 3) {
              case 0:
            }
            try {
              v6 = v1;
            } finally {
              switch (v0 & 3) {
              }
            }
            try {
            } catch (thrown) {
            }
        }
        try {
          v8 = v3;
        } finally {
        }
        try {
          for (const each of [v0, v0, 0]) {
          }
        } finally {
        }
        let c10 = 1;
        do {
          switch (v1 & 3) {
            case 0:
              v8.n = v0 + v0 | 0;
          }
          let c11 = 1;
            while (c11-- > 0) {
              v0 = v1 + v0 | 0;
            }
        } while (--c10 > 0 && v4.n > v0);
      }
      L12: {
        try {} finally {
        }
          break L12;
      }
    }
  } finally {
    switch (v0 & 3) {
    }
  }
  return v0 ^ v1 ^ fold(v2) ^ fold(v3) ^ fold(v4) ^ fold(v5) ^ fold(v6) ^ fold(v7) ^ fold(v8) ^ fold(v9) ^ fold(v10) ^ fold(v11) ^ fold(v12) ^ fold(v13) ^ fold(v14) ^ fold(v15) | 0;
}
let hash = 0;
const turns = Number(process.argv[2] ?? 100);
for (let i = 0; i < turns; i++) hash = (Math.imul(hash, 31) + f0(i, (i * 7) & 63)) | 0;
console.log("f0 " + (hash >>> 0).toString(16));
