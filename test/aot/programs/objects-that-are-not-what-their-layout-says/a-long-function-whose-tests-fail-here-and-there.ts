// A function of eighty stretches: each reads a field behind a test of the object, and between any two of them code that nobody knows may run and change the object.
// Whatever fails, and wherever, the rest of the function goes on with what plain Bun computes.
class S {
  flags: number;
  other: number;
  declare late?: object;
  constructor(flags: number) {
    this.flags = flags;
    this.other = flags + 1;
  }
}

let victim: any = null;
let mutation = "none";
(globalThis as any).changeTheVictim = function (acc: number): unknown {
  switch (mutation) {
    case "delete":
      delete victim.flags;
      break;
    case "getter":
      Object.defineProperty(victim, "flags", { get: () => 5, configurable: true });
      break;
    case "string":
      victim.flags = "7";
      break;
    case "undefined":
      victim.flags = undefined;
      break;
    case "late":
      victim.late = { acc };
      break;
    case "late getter":
      Object.defineProperty(victim, "late", { get: () => null, configurable: true });
      break;
    case "freeze":
      Object.freeze(victim);
      break;
    case "prototype":
      Object.setPrototypeOf(victim, { flags: 11, late: victim });
      delete victim.flags;
      break;
    case "answer a string":
      return String(acc);
    case "answer nothing":
      return undefined;
  }
  return acc;
};
const hook: any = (globalThis as any)[process.env.NAME_OF_HOOK ?? "changeTheVictim"];

function eightyStretches(s: S, start: number): number {
  let acc = start;
  acc = (acc + s.flags * 3) | 0; if (acc === 1000003) acc = hook(acc);
  acc = (acc + s.flags * 4) | 0; if (acc === 1000004) acc = hook(acc);
  acc = (acc + s.flags * 5) | 0; if (acc === 1000005) acc = hook(acc);
  acc = (acc + s.flags * 6) | 0; if (acc === 1000006) acc = hook(acc);
  acc = (acc + s.flags * 7) | 0; if (acc === 1000007) acc = hook(acc);
  acc = (acc + s.flags * 8) | 0; if (acc === 1000008) acc = hook(acc);
  acc = (acc + s.flags * 9) | 0; if (acc === 1000009) acc = hook(acc);
  acc = (acc + s.flags * 10) | 0; if (acc === 1000010) acc = hook(acc); if (s.late) acc = (acc + 1) | 0;
  acc = (acc + s.flags * 11) | 0; if (acc === 1000011) acc = hook(acc);
  acc = (acc + s.flags * 12) | 0; if (acc === 1000012) acc = hook(acc);
  acc = (acc + s.flags * 13) | 0; if (acc === 1000013) acc = hook(acc);
  acc = (acc + s.flags * 14) | 0; if (acc === 1000014) acc = hook(acc);
  acc = (acc + s.flags * 15) | 0; if (acc === 1000015) acc = hook(acc);
  acc = (acc + s.flags * 16) | 0; if (acc === 1000016) acc = hook(acc);
  acc = (acc + s.flags * 17) | 0; if (acc === 1000017) acc = hook(acc);
  acc = (acc + s.flags * 18) | 0; if (acc === 1000018) acc = hook(acc);
  acc = (acc + s.flags * 19) | 0; if (acc === 1000019) acc = hook(acc);
  acc = (acc + s.flags * 20) | 0; if (acc === 1000020) acc = hook(acc);
  acc = (acc + s.flags * 21) | 0; if (acc === 1000021) acc = hook(acc);
  acc = (acc + s.flags * 22) | 0; if (acc === 1000022) acc = hook(acc);
  acc = (acc + s.flags * 23) | 0; if (acc === 1000023) acc = hook(acc);
  acc = (acc + s.flags * 24) | 0; if (acc === 1000024) acc = hook(acc);
  acc = (acc + s.flags * 25) | 0; if (acc === 1000025) acc = hook(acc);
  acc = (acc + s.flags * 26) | 0; if (acc === 1000026) acc = hook(acc); if (s.late) acc = (acc + 1) | 0;
  acc = (acc + s.flags * 27) | 0; if (acc === 1000027) acc = hook(acc);
  acc = (acc + s.flags * 28) | 0; if (acc === 1000028) acc = hook(acc);
  acc = (acc + s.flags * 29) | 0; if (acc === 1000029) acc = hook(acc);
  acc = (acc + s.flags * 30) | 0; if (acc === 1000030) acc = hook(acc);
  acc = (acc + s.flags * 31) | 0; if (acc === 1000031) acc = hook(acc);
  acc = (acc + s.flags * 32) | 0; if (acc === 1000032) acc = hook(acc);
  acc = (acc + s.flags * 33) | 0; if (acc === 1000033) acc = hook(acc);
  acc = (acc + s.flags * 34) | 0; if (acc === 1000034) acc = hook(acc);
  acc = (acc + s.flags * 35) | 0; if (acc === 1000035) acc = hook(acc);
  acc = (acc + s.flags * 36) | 0; if (acc === 1000036) acc = hook(acc);
  acc = (acc + s.flags * 37) | 0; if (acc === 1000037) acc = hook(acc);
  acc = (acc + s.flags * 38) | 0; if (acc === 1000038) acc = hook(acc);
  acc = (acc + s.flags * 39) | 0; if (acc === 1000039) acc = hook(acc);
  acc = (acc + s.flags * 40) | 0; if (acc === 1000040) acc = hook(acc);
  acc = (acc + s.flags * 41) | 0; if (acc === 1000041) acc = hook(acc);
  acc = (acc + s.flags * 42) | 0; if (acc === 1000042) acc = hook(acc); if (s.late) acc = (acc + 1) | 0;
  acc = (acc + s.flags * 43) | 0; if (acc === 1000043) acc = hook(acc);
  acc = (acc + s.flags * 44) | 0; if (acc === 1000044) acc = hook(acc);
  acc = (acc + s.flags * 45) | 0; if (acc === 1000045) acc = hook(acc);
  acc = (acc + s.flags * 46) | 0; if (acc === 1000046) acc = hook(acc);
  acc = (acc + s.flags * 47) | 0; if (acc === 1000047) acc = hook(acc);
  acc = (acc + s.flags * 48) | 0; if (acc === 1000048) acc = hook(acc);
  acc = (acc + s.flags * 49) | 0; if (acc === 1000049) acc = hook(acc);
  acc = (acc + s.flags * 50) | 0; if (acc === 1000050) acc = hook(acc);
  acc = (acc + s.flags * 51) | 0; if (acc === 1000051) acc = hook(acc);
  acc = (acc + s.flags * 52) | 0; if (acc === 1000052) acc = hook(acc);
  acc = (acc + s.flags * 53) | 0; if (acc === 1000053) acc = hook(acc);
  acc = (acc + s.flags * 54) | 0; if (acc === 1000054) acc = hook(acc);
  acc = (acc + s.flags * 55) | 0; if (acc === 1000055) acc = hook(acc);
  acc = (acc + s.flags * 56) | 0; if (acc === 1000056) acc = hook(acc);
  acc = (acc + s.flags * 57) | 0; if (acc === 1000057) acc = hook(acc);
  acc = (acc + s.flags * 58) | 0; if (acc === 1000058) acc = hook(acc); if (s.late) acc = (acc + 1) | 0;
  acc = (acc + s.flags * 59) | 0; if (acc === 1000059) acc = hook(acc);
  acc = (acc + s.flags * 60) | 0; if (acc === 1000060) acc = hook(acc);
  acc = (acc + s.flags * 61) | 0; if (acc === 1000061) acc = hook(acc);
  acc = (acc + s.flags * 62) | 0; if (acc === 1000062) acc = hook(acc);
  acc = (acc + s.flags * 63) | 0; if (acc === 1000063) acc = hook(acc);
  acc = (acc + s.flags * 64) | 0; if (acc === 1000064) acc = hook(acc);
  acc = (acc + s.flags * 65) | 0; if (acc === 1000065) acc = hook(acc);
  acc = (acc + s.flags * 66) | 0; if (acc === 1000066) acc = hook(acc);
  acc = (acc + s.flags * 67) | 0; if (acc === 1000067) acc = hook(acc);
  acc = (acc + s.flags * 68) | 0; if (acc === 1000068) acc = hook(acc);
  acc = (acc + s.flags * 69) | 0; if (acc === 1000069) acc = hook(acc);
  acc = (acc + s.flags * 70) | 0; if (acc === 1000070) acc = hook(acc);
  acc = (acc + s.flags * 71) | 0; if (acc === 1000071) acc = hook(acc);
  acc = (acc + s.flags * 72) | 0; if (acc === 1000072) acc = hook(acc);
  acc = (acc + s.flags * 73) | 0; if (acc === 1000073) acc = hook(acc);
  acc = (acc + s.flags * 74) | 0; if (acc === 1000074) acc = hook(acc); if (s.late) acc = (acc + 1) | 0;
  acc = (acc + s.flags * 75) | 0; if (acc === 1000075) acc = hook(acc);
  acc = (acc + s.flags * 76) | 0; if (acc === 1000076) acc = hook(acc);
  acc = (acc + s.flags * 77) | 0; if (acc === 1000077) acc = hook(acc);
  acc = (acc + s.flags * 78) | 0; if (acc === 1000078) acc = hook(acc);
  acc = (acc + s.flags * 79) | 0; if (acc === 1000079) acc = hook(acc);
  acc = (acc + s.flags * 80) | 0; if (acc === 1000080) acc = hook(acc);
  acc = (acc + s.flags * 81) | 0; if (acc === 1000081) acc = hook(acc);
  acc = (acc + s.flags * 82) | 0; if (acc === 1000082) acc = hook(acc);
  return acc;
}

class K {
  static probe(s: S): number {
    return s.flags + (s.late ? 1 : 0) + s.other;
  }
}

// The start with which the hook runs in the given section, for an object whose flags are as given up to there.
function startFor(section: number, flags: number): number {
  let factors = 0;
  for (let i = 0; i < section; i++) factors += i + 3;
  return 1000003 + (section - 1) - flags * factors;
}

const mutations = ["none", "delete", "getter", "string", "undefined", "late", "late getter", "freeze", "prototype", "answer a string", "answer nothing"];
for (const name of mutations) {
  const line: unknown[] = [];
  for (const section of [1, 2, 8, 9, 24, 40, 63, 79, 80]) {
    const s = new S(3);
    victim = s;
    mutation = name;
    line.push(eightyStretches(s, startFor(section, 3)), K.probe(s));
    mutation = "none";
    line.push(eightyStretches(s, 1), K.probe(s));
  }
  console.log(name, line.join(" "));
}

// Objects that are odd from the start.
const odd: any[] = [];
{
  const a = new S(4);
  delete (a as any).flags;
  const b = new S(4);
  Object.defineProperty(b, "other", { value: 9, writable: false });
  const c = new S(4);
  (c as any).extra = 1;
  const d = Object.create(new S(6));
  const e = { flags: 2, other: 3 };
  const f = { flags: 2.5, other: "x", late: 0 };
  odd.push(a, b, c, d, e, f);
}
mutation = "none";
console.log(odd.map(o => eightyStretches(o, 1) + ":" + K.probe(o)).join(" "));

let sum = 0;
const plain = new S(1);
for (let round = 0; round < 20000; round++) sum = (sum + eightyStretches(plain, round) + K.probe(plain)) | 0;
console.log(sum);
