// A function has over a hundred variables. A closure changes one of them and reads another, and is called on some ways only. Loops inside try blocks read and store those variables in every turn,
// and calls that the compiler cannot look through throw at one place after the other.
class Box {
  constructor(
    public n: number,
    public next: Box | null,
  ) {}
}
let calls = 0;
let fuse = 0;
class Blown extends Error {}
function tick(): void {
  calls++;
  if (fuse > 0 && --fuse === 0) throw new Blown("blown");
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueDouble(x: number, y: number): number {
  tick();
  return x * 0.75 + y;
}
function opaqueText(x: string, y: number): string {
  tick();
  return (x + (y & 7)).slice(-5);
}
function opaqueBox(x: Box, y: number): Box {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
async function opaqueLater(x: number): Promise<number> {
  tick();
  return (x + 1) | 0;
}
function opaqueAny(x: any): any {
  tick();
  return x;
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : (value * 1000) | 0;
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

function f0(a: number, b: number): number {
  const spare = new Box(a, null);
  let v0: number = (a * 1 + b * 7 + 12) | 0;
  let v1: number = (a * 2 + b * 4 + 21) | 0;
  let v2: number = a * 2.5 + b / 4;
  let v3: number = (a * 4 + b * 1 + 7) | 0;
  let v4: number = (a * 5 + b * 5 + 0) | 0;
  let v5: number = (a * 6 + b * 5 + 7) | 0;
  let v6: number = a * 6.5 + b / 4;
  let v7: number = (a * 8 + b * 2 + 43) | 0;
  let v8: number = (a * 9 + b * 7 + 34) | 0;
  let v9: number = (a * 10 + b * 5 + 47) | 0;
  let v10: number = a * 10.5 + b / 4;
  let v11: number = (a * 12 + b * 5 + 16) | 0;
  let v12: number = (a * 13 + b * 5 + 48) | 0;
  let v13: number = (a * 14 + b * 0 + 47) | 0;
  let v14: number = (a * 15 + b * 2 + 9) | 0;
  let v15: number = (a * 16 + b * 1 + 7) | 0;
  let v16: number = (a * 17 + b * 7 + 20) | 0;
  let v17: number = (a * 18 + b * 7 + 41) | 0;
  let v18: number = (a * 19 + b * 2 + 45) | 0;
  let v19: number = a * 19.5 + b / 4;
  let v20: number = (a * 21 + b * 5 + 8) | 0;
  let v21: number = (a * 22 + b * 4 + 24) | 0;
  let v22: number = (a * 23 + b * 1 + 29) | 0;
  let v23: number = (a * 24 + b * 1 + 49) | 0;
  let v24: number = a * 24.5 + b / 4;
  let v25: number = (a * 26 + b * 0 + 2) | 0;
  let v26: number = a * 26.5 + b / 4;
  let v27: number = (a * 28 + b * 1 + 22) | 0;
  let v28: number = a * 28.5 + b / 4;
  let v29: number = a * 29.5 + b / 4;
  let v30: number = (a * 31 + b * 3 + 21) | 0;
  let v31: number = (a * 32 + b * 4 + 39) | 0;
  let v32: number = a * 32.5 + b / 4;
  let v33: number = (a * 34 + b * 8 + 40) | 0;
  let v34: number = (a * 35 + b * 7 + 32) | 0;
  let v35: number = (a * 36 + b * 8 + 3) | 0;
  let v36: number = a * 36.5 + b / 4;
  let v37: number = a * 37.5 + b / 4;
  let v38: number = (a * 39 + b * 3 + 13) | 0;
  let v39: number = a * 39.5 + b / 4;
  let v40: number = (a * 41 + b * 8 + 4) | 0;
  let v41: number = (a * 42 + b * 0 + 15) | 0;
  let v42: number = a * 42.5 + b / 4;
  let v43: number = a * 43.5 + b / 4;
  let v44: number = a * 44.5 + b / 4;
  let v45: number = (a * 46 + b * 4 + 17) | 0;
  let v46: number = (a * 47 + b * 8 + 44) | 0;
  let v47: number = a * 47.5 + b / 4;
  let v48: number = (a * 49 + b * 4 + 32) | 0;
  let v49: number = a * 49.5 + b / 4;
  let v50: number = (a * 51 + b * 7 + 15) | 0;
  let v51: number = (a * 52 + b * 2 + 2) | 0;
  let v52: number = (a * 53 + b * 0 + 27) | 0;
  let v53: number = a * 53.5 + b / 4;
  let v54: number = (a * 55 + b * 0 + 40) | 0;
  let v55: number = a * 55.5 + b / 4;
  let v56: number = (a * 57 + b * 6 + 39) | 0;
  let v57: number = (a * 58 + b * 5 + 15) | 0;
  let v58: number = (a * 59 + b * 8 + 27) | 0;
  let v59: number = (a * 60 + b * 5 + 45) | 0;
  let v60: number = (a * 61 + b * 2 + 6) | 0;
  let v61: number = (a * 62 + b * 0 + 29) | 0;
  let v62: number = (a * 63 + b * 5 + 13) | 0;
  let v63: number = a * 63.5 + b / 4;
  let v64: number = (a * 65 + b * 4 + 31) | 0;
  let v65: number = a * 65.5 + b / 4;
  let v66: number = a * 66.5 + b / 4;
  let v67: number = (a * 68 + b * 6 + 6) | 0;
  let v68: number = a * 68.5 + b / 4;
  let v69: number = a * 69.5 + b / 4;
  let v70: number = (a * 71 + b * 3 + 31) | 0;
  let v71: number = (a * 72 + b * 1 + 24) | 0;
  let v72: number = (a * 73 + b * 2 + 31) | 0;
  let v73: number = (a * 74 + b * 8 + 44) | 0;
  let v74: number = a * 74.5 + b / 4;
  let v75: number = (a * 76 + b * 6 + 3) | 0;
  let v76: number = (a * 77 + b * 6 + 46) | 0;
  let v77: number = a * 77.5 + b / 4;
  let v78: number = (a * 79 + b * 1 + 22) | 0;
  let v79: number = (a * 80 + b * 0 + 2) | 0;
  let v80: number = (a * 81 + b * 3 + 30) | 0;
  let v81: number = (a * 82 + b * 1 + 32) | 0;
  let v82: number = a * 82.5 + b / 4;
  let v83: number = (a * 84 + b * 2 + 38) | 0;
  let v84: number = (a * 85 + b * 5 + 47) | 0;
  let v85: number = a * 85.5 + b / 4;
  let v86: number = (a * 87 + b * 7 + 35) | 0;
  let v87: number = (a * 88 + b * 0 + 45) | 0;
  let v88: number = (a * 89 + b * 5 + 34) | 0;
  let v89: number = (a * 90 + b * 5 + 27) | 0;
  let v90: number = a * 90.5 + b / 4;
  let v91: number = (a * 92 + b * 4 + 20) | 0;
  let v92: number = (a * 93 + b * 1 + 4) | 0;
  let v93: number = (a * 94 + b * 5 + 13) | 0;
  let v94: number = (a * 95 + b * 0 + 17) | 0;
  let v95: number = a * 95.5 + b / 4;
  let v96: number = (a * 97 + b * 3 + 31) | 0;
  let v97: number = (a * 98 + b * 6 + 3) | 0;
  let v98: number = (a * 99 + b * 4 + 37) | 0;
  let v99: number = a * 99.5 + b / 4;
  let v100: number = a * 100.5 + b / 4;
  let v101: number = (a * 102 + b * 8 + 16) | 0;
  let v102: number = a * 102.5 + b / 4;
  let v103: number = (a * 104 + b * 0 + 47) | 0;
  let v104: number = a * 104.5 + b / 4;
  let v105: number = a * 105.5 + b / 4;
  let v106: number = a * 106.5 + b / 4;
  let v107: number = a * 107.5 + b / 4;
  let v108: number = (a * 109 + b * 1 + 15) | 0;
  let v109: number = (a * 110 + b * 7 + 34) | 0;
  let v110: number = (a * 111 + b * 0 + 5) | 0;
  let v111: number = (a * 112 + b * 0 + 47) | 0;
  let v112: number = a * 112.5 + b / 4;
  let v113: number = a * 113.5 + b / 4;
  let v114: number = (a * 115 + b * 3 + 14) | 0;
  let v115: number = a * 115.5 + b / 4;
  let v116: number = a * 116.5 + b / 4;
  let v117: number = (a * 118 + b * 5 + 7) | 0;
  let v118: number = (a * 119 + b * 1 + 10) | 0;
  let v119: number = (a * 120 + b * 6 + 20) | 0;
  const closure0 = (x: number): number => {
    v87 = (v87 + x) | 0;
    return v87 ^ v54;
  };
  let c0 = 2;
  do {
    try {
      v63 = Math.floor(v24) + 0.25;
      let c1 = 1;
      do {
        try {
          v84 = (v87 + v18) | 0;
          if (v91 < v57) throw v109;
          v36 = v29 - v111 * 0.25;
          v79 = (v34 + v109) | 0;
          v100 = v117 > 0 ? v26 : v117 + 0.5;
        } catch (thrown) {
          v7 = ((thrown as number) | 0) + 1;
          v48 = (v104 * 3) | 0;
        } finally {
          v12 = v46 % ((v45 & 15) + 1) | 0;
        }
        v4 = v31 < 0 || v94 < 0 ? Math.imul(v11, v67) : (v61 + v40) | 0;
        for (const each of [v97, v41, 5]) {
          v3 = (v8 + each) | 0;
          v57 = v33 > v71 ? v33 : v71;
          v30 = (v8 >>> 3) & 1023;
          v115 = v118 & 1 ? NaN : v44;
          v88 = (v71 * 0.5 + v14) | 0;
        }
      } while (--c1 > 0 && (v38 < 0 || v110 < 0));
      v46 = v36 < v86 ? (v21 >>> 3) & 1023 : closure0(v35);
    } finally {
      v70 = (v30 & v7) | 1;
    }
    L2: for (let c2 = 0; c2 < 2; c2++) {
      v66 = v99 * 0.5 + v46;
      v96 = (v114 + v12) | 0;
      v86 = v12 < 0 || v22 < 0 ? (v17 * 0.5 + v108) | 0 : closure0(v96);
      try {
        try {
          v78 = v50 ^ v13;
          v109 = v108 > 0 ? v108 : v9;
        } finally {
          v13 = "t".length;
        }
        if (v24 < v70) throw v98;
        v41 = spare.n | 0;
      } catch (thrown) {
        v34 = ((thrown as number) | 0) + 1;
        v38 = (v5 >>> 3) & 1023;
      } finally {
        v118 = (v0 + v18) | 0;
      }
    }
  } while (--c0 > 0 && (v51 < 0 || v57 < 0));
  try {
    v40 = (v88 >>> 3) & 1023;
    if (v73 > 2) throw v98;
    v36 = v105 * 0.5 + v81;
    v112 = v67 & 1 ? NaN : v10;
  } catch (thrown) {
    v34 = ((thrown as number) | 0) + 1;
    v42 = v89 & 3 ? v28 : -0;
  } finally {
    v105 = Math.floor(v77) + 0.25;
  }
  return (
    (v0 ^
      v1 ^
      fold(v2) ^
      v3 ^
      v4 ^
      v5 ^
      fold(v6) ^
      v7 ^
      v8 ^
      v9 ^
      fold(v10) ^
      v11 ^
      v12 ^
      v13 ^
      v14 ^
      v15 ^
      v16 ^
      v17 ^
      v18 ^
      fold(v19) ^
      v20 ^
      v21 ^
      v22 ^
      v23 ^
      fold(v24) ^
      v25 ^
      fold(v26) ^
      v27 ^
      fold(v28) ^
      fold(v29) ^
      v30 ^
      v31 ^
      fold(v32) ^
      v33 ^
      v34 ^
      v35 ^
      fold(v36) ^
      fold(v37) ^
      v38 ^
      fold(v39) ^
      v40 ^
      v41 ^
      fold(v42) ^
      fold(v43) ^
      fold(v44) ^
      v45 ^
      v46 ^
      fold(v47) ^
      v48 ^
      fold(v49) ^
      v50 ^
      v51 ^
      v52 ^
      fold(v53) ^
      v54 ^
      fold(v55) ^
      v56 ^
      v57 ^
      v58 ^
      v59 ^
      v60 ^
      v61 ^
      v62 ^
      fold(v63) ^
      v64 ^
      fold(v65) ^
      fold(v66) ^
      v67 ^
      fold(v68) ^
      fold(v69) ^
      v70 ^
      v71 ^
      v72 ^
      v73 ^
      fold(v74) ^
      v75 ^
      v76 ^
      fold(v77) ^
      v78 ^
      v79 ^
      v80 ^
      v81 ^
      fold(v82) ^
      v83 ^
      v84 ^
      fold(v85) ^
      v86 ^
      v87 ^
      v88 ^
      v89 ^
      fold(v90) ^
      v91 ^
      v92 ^
      v93 ^
      v94 ^
      fold(v95) ^
      v96 ^
      v97 ^
      v98 ^
      fold(v99) ^
      fold(v100) ^
      v101 ^
      fold(v102) ^
      v103 ^
      fold(v104) ^
      fold(v105) ^
      fold(v106) ^
      fold(v107) ^
      v108 ^
      v109 ^
      v110 ^
      v111 ^
      fold(v112) ^
      fold(v113) ^
      v114 ^
      fold(v115) ^
      fold(v116) ^
      v117 ^
      v118 ^
      v119) |
    0
  );
}
{
  let hash = 0;
  for (let i = 0; i < 100; i++) hash = (Math.imul(hash, 31) + f0(i, (i * 7) & 63)) | 0;
  for (let at = 1; at <= 600; at++) {
    const i = at & 15;
    fuse = at;
    try {
      hash = (Math.imul(hash, 31) + f0(i, (i * 7) & 63)) | 0;
    } catch (error) {
      hash = (Math.imul(hash, 31) + (error instanceof Blown ? 7 : 11)) | 0;
    }
    if (fuse > 0) break;
  }
  fuse = 0;
  console.log("f0 " + (hash >>> 0).toString(16));
}

function f1(a: number, b: number): number {
  const spare = new Box(a, null);
  let v0: number = (a * 1 + b * 8 + 35) | 0;
  let v1: number = (a * 2 + b * 5 + 31) | 0;
  let v2: number = (a * 3 + b * 8 + 32) | 0;
  let v3: number = (a * 4 + b * 8 + 38) | 0;
  let v4: number = (a * 5 + b * 2 + 21) | 0;
  let v5: number = (a * 6 + b * 3 + 7) | 0;
  let v6: number = (a * 7 + b * 1 + 6) | 0;
  let v7: number = (a * 8 + b * 7 + 12) | 0;
  let v8: number = (a * 9 + b * 3 + 8) | 0;
  let v9: number = (a * 10 + b * 8 + 32) | 0;
  let v10: number = (a * 11 + b * 6 + 15) | 0;
  let v11: number = (a * 12 + b * 3 + 33) | 0;
  let v12: number = (a * 13 + b * 2 + 10) | 0;
  let v13: number = (a * 14 + b * 7 + 22) | 0;
  let v14: number = (a * 15 + b * 4 + 44) | 0;
  let v15: number = (a * 16 + b * 5 + 28) | 0;
  for (const each of [v11, v15, 4]) {
    v4 = (v4 + each) | 0;
    v5 = v5 ^ v15;
    v13 = v5 % ((v9 & 15) + 1) | 0;
  }
  try {
    if (v0 > v12) {
      v15 = (v9 + 98) | 0;
    } else {
      switch (v3 & 3) {
        case 0:
          v11 = (v11 + 81) | 0;
          try {
            if (v6 < 44) {
              v1 = (v12 >> (v13 & 7)) | 0;
              v3 = "t".length;
            } else {
              v12 = (v13 + v14) | 0;
              v12 = (v3 & v15) | 1;
              v7 = fold(v5);
            }
            try {
              v10 = v10 ^ v8;
              v14 = v11 ^ v2;
              v2 = "t".length;
              v6 = (v9 + 31) | 0;
            } finally {
              v4 = v1 ^ v6;
            }
            try {
              v12 = fold(v0);
              v9 = (v13 >>> 3) & 1023;
              v12 = "t".length;
              v4 = fold(v4);
            } finally {
              v12 = opaqueInt(v6, v7);
            }
            for (const each of [v9, v2, 2]) {
              v12 = (v0 + each) | 0;
              v15 = (v8 + v14) | 0;
            }
          } catch (thrown) {
            v6 = ((thrown as number) | 0) + 1;
            v14 = v10 > 0 ? v10 : v13;
          } finally {
            v6 = (v10 + 90) | 0;
          }
        case 2:
          v9 = (v4 - v13) | 0;
          v4 = opaqueInt(v5, v11);
          break;
        default:
          v15 = v0 ^ v15;
      }
    }
    if (v4 < 0 || v6 < 0) throw v5;
  } catch (thrown) {
    v3 = ((thrown as number) | 0) + 1;
    v0 = v0 % ((v12 & 15) + 1) | 0;
  } finally {
    v7 = v11 % ((v1 & 15) + 1) | 0;
  }
  return (v0 ^ v1 ^ v2 ^ v3 ^ v4 ^ v5 ^ v6 ^ v7 ^ v8 ^ v9 ^ v10 ^ v11 ^ v12 ^ v13 ^ v14 ^ v15) | 0;
}
{
  let hash = 0;
  for (let i = 0; i < 20; i++) hash = (Math.imul(hash, 31) + f1(i, (i * 7) & 63)) | 0;
  for (let at = 1; at <= 600; at++) {
    const i = at & 15;
    fuse = at;
    try {
      hash = (Math.imul(hash, 31) + f1(i, (i * 7) & 63)) | 0;
    } catch (error) {
      hash = (Math.imul(hash, 31) + (error instanceof Blown ? 7 : 11)) | 0;
    }
    if (fuse > 0) break;
  }
  fuse = 0;
  console.log("f1 " + (hash >>> 0).toString(16));
}

export {};
