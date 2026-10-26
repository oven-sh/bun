let fuel = 6000,
  sum = 0,
  count = 0;
const first: string[] = [];
function log(id: number, v: unknown): number {
  count++;
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? v.length
        : v === undefined
          ? -1
          : v === null
            ? -2
            : v === true
              ? 1
              : 0;
  sum = (Math.imul(sum, 31) + id * 7 + (n | 0) + (n !== n ? 13 : 0) + (Object.is(n, -0) ? 17 : 0)) | 0;
  if (first.length < 60) first.push(id + ":" + String(v));
  return typeof v === "number" ? v : n;
}
const later: (() => number)[] = [];
const K0: number = 0,
  K1: number = 1,
  K2: number = 2,
  K3: number = 3,
  K4: number = 7,
  K5: number = -1,
  K6: number = 31,
  K7: number = 32,
  K8: number = 255,
  K9: number = 65535,
  K10: number = 2147483647,
  K11: number = -2147483648,
  K12: number = 4294967295,
  K13: number = 0.5,
  K14: number = -0.5,
  K15: number = 1e9,
  K16: number = 1e21,
  K17: number = -0,
  K18: number = NaN,
  K19: number = Infinity;
function f0(p0_0: number, p0_1: number, p0_2: number): number {
  if (--fuel < 0) return 0;
  let v0_0: number = log(1, p0_2 ^ p0_1);
  p0_1 *= K7;
  {
    let t2: number = p0_0 < p0_2 * Math.ceil(p0_2 < p0_0 ? v0_0 : p0_2) ? K16 : Math.sign(-(p0_2 >>> v0_0));
    log(3, v0_0);
    try {
      L5: for (let i4 = 0; i4 < 2; i4++) {
        if (--fuel < 0) break;
        p0_0++;
        i4++;
      }
      B6: {
        p0_1 ^= K11;
      }
    } catch (e7) {
      log(8, typeof e7 === "number" ? e7 : -9);
    } finally {
      p0_2 = Math.ceil(K5 < v0_0 ? -(-p0_0) : p0_2 - v0_0 <= p0_2 + p0_1 ? -t2 : v0_0 << p0_0);
      if (p0_1 <= Math.ceil(p0_2)) throw p0_2 / t2 === (p0_0 | 0) ? K12 : p0_2;
    }
    if (v0_0 === p0_2) return K10;
  }
  p0_0--;
  B9: {
    L11: for (let i10 = 0; i10 < 4; i10++) {
      if (--fuel < 0) break;
      p0_0 -= p0_2;
      try {
        log(
          12,
          ~((p0_1 ^ v0_0 || (p0_0 <= p0_0 ? i10 : p0_0)) < Math.abs(log(13, p0_1))
            ? p0_1 !== K2
              ? p0_1 | 0
              : Math.round(v0_0)
            : p0_2 || p0_2 / p0_0),
        );
        log(14, K1 & -((i10 + p0_0) << Math.min(p0_2, v0_0)));
        log(15, (K4 | 0) / (p0_0 % (p0_0 * i10) || v0_0));
      } catch (e17) {
        log(18, typeof e17 === "number" ? e17 : -9);
      } finally {
        i10--;
      }
    }
    try {
      log(19, -(p0_2 * p0_1 + K0 && Math.imul(p0_1, K2)));
      {
        let t20: number = Math.floor(~(p0_1 << (p0_2 | 0)));
        log(21, p0_1);
        log(22, p0_2);
        v0_0 >>>= ~((t20 !== p0_2 ? p0_1 : p0_1) + (t20 | 0) && p0_2 - p0_2);
      }
    } finally {
      log(25, (K11 - (v0_0 <= p0_0 ? p0_0 : p0_1) && Math.min(v0_0 | 0, v0_0 >> v0_0)) | 0);
      p0_1 <<= Math.ceil(Math.max(p0_0, log(26, p0_2)) % K18);
    }
  }
  return p0_2;
}
function* f1(p1_0: number, p1_1: number): Generator<number> {
  if (--fuel < 0) return;
  let v1_0: number = K3;
  let v1_1: number = p1_0;
  let v1_2: number = p1_1 | 0 | 0;
  log(27, p1_0);
  if (v1_1 >>> v1_2 <= ((v1_0 || v1_0) | 0)) return v1_2 >>> p1_1;
  log(28, -(v1_2 + p1_1 && v1_0) | 0);
  v1_2++;
  if (v1_1 < p1_0) return (v1_1 === v1_0 ? Math.max(v1_0 >>> v1_0, p1_1 >>> p1_1) : p1_0 + Math.floor(v1_1)) | 0;
  v1_0++;
}
function f2(): number {
  if (--fuel < 0) return 0;
  let v2_0: number = (K1 % K1) - K1;
  let v2_1: number = (K1 < K1 ? K1 : K1) || K1;
  let v2_2: number = K1;
  {
    let w31 = 0;
    L30: do {
      if (--fuel < 0) break;
      for (let i32 = 0; i32 < 5; i32 += 2) {
        if (--fuel < 0) break;
        v2_2 |= i32;
      }
      switch (v2_1 % 6 | 0) {
        case 0:
          if (K0 !== v2_0) throw w31 !== v2_0 - v2_0 ? v2_1 : v2_2;
          B34: {
            log(35, -(K6 * (v2_2 ^ w31)) ^ v2_2);
            log(36, (((v2_0 !== v2_2 ? w31 : w31) | 0) ^ ((v2_0 && v2_1) & K6)) | Math.floor(w31));
          }
          break;
        default:
          try {
            v2_0 = v2_2;
            v2_0++;
            v2_1 |= K7;
          } catch (e44) {
            log(45, typeof e44 === "number" ? e44 : -9);
            log(46, K7);
          }
          break;
        case 3:
          try {
            log(37, log(38, w31 % v2_2));
            v2_1 -= v2_0;
          } finally {
            v2_2 %= v2_2;
          }
          break;
        case 2:
          w31++;
          break;
      }
    } while (++w31 < 1);
  }
  if ((Math.max(v2_1, v2_2) !== v2_1 ? v2_0 | 0 : v2_2) < (v2_2 & K19)) return v2_2;
  return v2_0;
}
function f3(p3_0: number): number {
  if (--fuel < 0) return 0;
  let v3_0: number = p3_0;
  p3_0--;
  log(48, K7);
  v3_0 <<= Math.round(K2);
  {
    let w50 = 0;
    do {
      if (--fuel < 0) break;
      B51: {
        try {
          p3_0 ^= w50;
          w50--;
          v3_0 |=
            (((v3_0 / v3_0) >> -p3_0) - Math.max(K17, Math.floor(w50))) & Math.clz32(Math.min(p3_0 << v3_0, p3_0));
        } finally {
          v3_0 -= v3_0 | 0 | 0;
          p3_0--;
        }
        v3_0 += ~K10 | 0;
      }
    } while (++w50 < 4);
  }
  {
    let w55 = 0;
    L54: while (w55++ < 1) {
      if (--fuel < 0) break;
      for (const c56 of f1(p3_0, p3_0)) {
        if (--fuel < 0) break;
        log(57, c56);
        if (p3_0 !== w55) break;
      }
      if ((p3_0 | v3_0) >> K18 <= ~v3_0) break L54;
    }
  }
  return p3_0;
}
function f4(p4_0: number): number {
  if (--fuel < 0) return 0;
  let v4_0: number = (p4_0 <= p4_0 ? p4_0 : p4_0) && p4_0 | 0;
  p4_0 = f2();
  B58: {
    log(59, 0);
    B60: {
      v4_0++;
      try {
        log(61, ((p4_0 | 0 | 0) / (p4_0 - Math.max(p4_0, v4_0))) << p4_0);
      } catch (e63) {
        log(64, typeof e63 === "number" ? e63 : -9);
      } finally {
        p4_0 = log(65, (v4_0 % v4_0 === (p4_0 < p4_0 ? v4_0 : p4_0) ? K18 : p4_0 | 0) << K19);
        v4_0--;
      }
    }
    try {
      try {
        p4_0 >>= Math.imul(-Math.imul(p4_0 | 0, K10), K9);
        p4_0 *=
          (p4_0 & K10) < v4_0
            ? v4_0 === (p4_0 < v4_0 ? v4_0 : v4_0) >> K3
              ? (p4_0 === v4_0 ? p4_0 : v4_0) % (v4_0 - v4_0)
              : p4_0 || v4_0 || v4_0 % p4_0
            : v4_0;
      } catch (e66) {
        log(67, typeof e66 === "number" ? e66 : -9);
        v4_0 = Math.min(
          ((p4_0 | 0) & (v4_0 || v4_0)) % v4_0,
          (p4_0 < p4_0 ? p4_0 : p4_0) - (p4_0 | 0) <= (v4_0 | 0 | 0)
            ? p4_0
            : (v4_0 === p4_0 ? p4_0 : v4_0) !== (v4_0 !== v4_0 ? v4_0 : p4_0)
              ? K19
              : p4_0 >>> p4_0,
        );
      } finally {
        p4_0++;
      }
      B68: {
        log(69, v4_0 === K18 ? -K11 : p4_0);
        p4_0 |= ~(v4_0 % v4_0 <= v4_0 ? -p4_0 : Math.imul(v4_0, p4_0)) | 0;
      }
      {
        let w72 = 0;
        while (w72++ < 5) {
          if (--fuel < 0) break;
          log(73, ~w72);
        }
      }
    } finally {
      v4_0 = f0(v4_0, v4_0, p4_0);
    }
  }
  switch (((p4_0 || p4_0) | (p4_0 || v4_0)) % 6 | 0) {
    case 4:
      if (log(80, -p4_0) !== K17) return -p4_0;
      break;
    case 5:
      {
        let w82 = 0;
        L81: do {
          if (--fuel < 0) break;
          p4_0--;
          if (log(83, ~w82) < (K16 | 0)) continue;
        } while (++w82 < 2);
      }
      break;
    case 1:
      p4_0--;
      p4_0 |= -v4_0;
      break;
    default:
      B84: {
        v4_0 *=
          K16 < v4_0
            ? ~(p4_0 / v4_0) ^ ~p4_0
            : Math.min(p4_0 || Math.max(v4_0, v4_0), (p4_0 !== v4_0 ? v4_0 : v4_0) / Math.max(v4_0, p4_0));
      }
    case 0:
      break;
  }
  L86: for (let i85 = 1; i85 < 6; i85++) {
    if (--fuel < 0) break;
    switch (log(94, p4_0 | 0) % 6 | 0) {
      case 4:
        log(87, ((K3 << -i85) | log(88, v4_0)) << Math.min(K19, log(89, p4_0) + Math.fround(v4_0)));
        break;
      case 0:
        switch ((v4_0 & K16) % 6 | 0) {
          default:
            log(90, -p4_0);
            break;
          case -1:
        }
      case 5:
        break;
      default:
        if (Math.abs(p4_0) + v4_0 === i85) {
          p4_0 = K1 || p4_0 | 0;
        } else {
          log(93, i85);
          p4_0--;
        }
      case 1:
        for (let i91 = -2; i91 < 4; i91++) {
          if (--fuel < 0) break;
          p4_0++;
        }
        if (v4_0 !== (v4_0 >>> v4_0) % (i85 * v4_0)) continue;
        break;
    }
    later.push(() => i85 + p4_0);
  }
  return log(95, v4_0 % p4_0 !== (p4_0 <= v4_0 ? v4_0 : p4_0) ? Math.imul(p4_0, v4_0) : K3) < v4_0
    ? ((v4_0 % p4_0) + p4_0) % p4_0
    : log(96, v4_0 * (p4_0 >>> v4_0));
}
function main(): number {
  let a: number = 1,
    b: number = 2,
    c_: number = -3,
    d: number = 0.5;
  try {
    L98: for (let i97 = 0; i97 < 2; i97++) {
      if (--fuel < 0) break;
      {
        let t99: number = d * c_;
        {
          let w101 = 0;
          do {
            if (--fuel < 0) break;
            {
              let t102: number = c_;
              i97 &= (((i97 <= c_ ? a : w101) >> (b && c_)) << (t99 << Math.min(a, a))) ^ w101;
              a--;
              i97--;
            }
          } while (++w101 < 4);
        }
      }
      switch (log(128, d ^ a) % 6 | 0) {
        case 4:
          if (((i97 & b) ^ -i97) < Math.max(i97 >> b, b)) return K18;
          break;
        case 2:
          break;
        case 5:
          try {
            {
              let w104 = 0;
              while (w104++ < 4) {
                if (--fuel < 0) break;
                d >>= c_;
                d ^= (a / Math.sign(Math.imul(d, i97))) >>> ((i97 <= a ? Math.sign(b) : d - b) * c_);
                log(105, a | w104);
              }
            }
            i97++;
          } catch (e106) {
            log(107, typeof e106 === "number" ? e106 : -9);
          }
          for (let i115 = 0; i115 < 1; i115 += 2) {
            if (--fuel < 0) break;
            switch (((c_ - i97) % K13) % 6 | 0) {
              case 5:
                log(117, Math.min(K8, a));
                break;
              case -1:
                log(118, Math.fround(c_));
                log(120, c_);
              case 0:
                break;
            }
            if (K19 !== i97) break L98;
            later.push(() => i115 + d);
          }
          break;
        case 0:
          L122: for (let i121 = 0; i121 < 5; i121++) {
            if (--fuel < 0) break;
            if (c_ < Math.max(b, i97 + a)) {
              log(123, K13);
              i121 %= c_;
            } else {
              log(124, Math.floor(a));
              i121 = -d;
            }
          }
          {
            let w127 = 0;
            while (w127++ < 4) {
              if (--fuel < 0) break;
              if (a / (i97 | 0) !== i97) throw b;
              d = f4(b === (i97 & b) ? b : c_ || i97);
              i97 |= a;
            }
          }
          break;
      }
    }
    B129: {
      {
        let w131 = 0;
        L130: while (w131++ < 5) {
          if (--fuel < 0) break;
          {
            let w133 = 0;
            while (w133++ < 5) {
              if (--fuel < 0) break;
              d |= K4;
            }
          }
          if (((a | 0) & d % a) === (b <= c_ ? K4 : w131 & w131)) continue;
          b = f3((b | 0) + (w131 << b));
        }
      }
    }
    if (b !== (a | 0 || a & d)) return a;
  } catch (e) {
    log(134, typeof e === "number" ? e : -7);
  }
  log(250, a);
  log(251, b);
  log(252, c_);
  log(253, d);
  return 0;
}
try {
  main();
} catch (e) {
  log(0, -8);
}
console.log(sum, count, fuel, first.join(" "));
